/**
 * 作物マスターの検証（R08/R09 / WBS 3.1）。
 *
 * データの「園芸的な正しさ」は機械では判定できない（レビューで担保する）。
 * ここで止めるのは**構造の崩れ** — 地域帯の抜け・月の範囲外・日数の逆転など、
 * 30 作物を手で書き足していく過程で必ず起きる種類の間違い。
 */
import { REGIONS } from '../../services/region.service';
import {
  CROP_CATEGORY_LABEL,
  CROP_CATEGORY_ORDER,
  CROP_MASTER,
  CROP_MASTER_ATTRIBUTION,
  CROP_MASTER_REFERENCES,
  CROP_MASTER_VERSION,
  PERENNIAL_FIRST_HARVEST_LABEL,
  attributionFor,
  findCropMaster,
  perennialNoticeFor,
  referencesFor,
} from '../crop-master';
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

import { runMigrations, syncCropMaster } from '../migrate';

/** id で必ず引ける前提のマスター（引けなければテストとして失敗させる） */
function crop(id: string) {
  const found = findCropMaster(id);
  if (!found) throw new Error(`${id} がマスターにありません`);
  return found;
}

describe('作物マスターの構造', () => {
  it('id は一意で crop- 始まり', () => {
    const ids = CROP_MASTER.map((crop) => crop.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^crop-[a-z-]+$/);
  });

  it('読み仮名はひらがな', () => {
    for (const crop of CROP_MASTER) {
      expect(crop.nameReading).toMatch(/^[ぁ-んー]+$/);
    }
  });

  it('科と単位が入っている', () => {
    for (const crop of CROP_MASTER) {
      expect(crop.family).toMatch(/科$/);
      expect(['piece', 'g', 'kg', 'bunch', 'plant']).toContain(crop.defaultUnit);
    }
  });

  it('全作物 × 全地域帯に「始めどき」と「収穫」の窓がある', () => {
    for (const crop of CROP_MASTER) {
      for (const region of REGIONS) {
        const windows = crop.calendars.filter((w) => w.region === region);
        const hasStart = windows.some((w) => w.kind === 'sow' || w.kind === 'plant');
        const hasHarvest = windows.some((w) => w.kind === 'harvest');
        expect([crop.id, region, hasStart].join(':')).toBe([crop.id, region, true].join(':'));
        expect([crop.id, region, hasHarvest].join(':')).toBe([crop.id, region, true].join(':'));
      }
    }
  });

  it('月は 1〜12 に収まる', () => {
    for (const crop of CROP_MASTER) {
      for (const w of crop.calendars) {
        expect(w.startMonth).toBeGreaterThanOrEqual(1);
        expect(w.startMonth).toBeLessThanOrEqual(12);
        expect(w.endMonth).toBeGreaterThanOrEqual(1);
        expect(w.endMonth).toBeLessThanOrEqual(12);
      }
    }
  });

  it('同じ地域 × kind の窓は 2 つまで（春秋の 2 期作を上限とする）', () => {
    for (const crop of CROP_MASTER) {
      for (const region of REGIONS) {
        for (const kind of ['sow', 'plant', 'harvest'] as const) {
          const count = crop.calendars.filter((w) => w.region === region && w.kind === kind).length;
          expect({ id: crop.id, region, kind, ok: count <= 2 }).toEqual({
            id: crop.id,
            region,
            kind,
            ok: true,
          });
        }
      }
    }
  });

  it('同じ地域 × kind の窓は startMonth が一意（同期の主キーが衝突しない）', () => {
    for (const crop of CROP_MASTER) {
      const keys = crop.calendars.map((w) => `${w.region}-${w.kind}-${w.startMonth}`);
      expect({ id: crop.id, unique: new Set(keys).size }).toEqual({
        id: crop.id,
        unique: keys.length,
      });
    }
  });

  it('ガイドの日数は 追肥 < 収穫 の順序になっている（多年草は収穫日数を持たない）', () => {
    for (const crop of CROP_MASTER) {
      const { fertilizeAfterDays, harvestAfterDays } = crop.guide;
      if (crop.perennial) {
        expect({ id: crop.id, harvestAfterDays }).toEqual({ id: crop.id, harvestAfterDays: null });
        expect(crop.guide.harvestWindowDays).toBeNull();
        continue;
      }
      expect({ id: crop.id, ok: harvestAfterDays != null && harvestAfterDays > 0 }).toEqual({
        id: crop.id,
        ok: true,
      });
      if (fertilizeAfterDays != null) {
        expect({ id: crop.id, ok: fertilizeAfterDays < (harvestAfterDays as number) }).toEqual({
          id: crop.id,
          ok: true,
        });
      }
    }
  });

  it('収穫の幅は 最小 ≤ 目安 ≤ 最大（4.19）', () => {
    for (const crop of CROP_MASTER) {
      const { harvestAfterDays, harvestWindowDays } = crop.guide;
      if (!harvestWindowDays) continue;
      expect({
        id: crop.id,
        ok:
          harvestWindowDays.min < harvestWindowDays.max &&
          harvestAfterDays != null &&
          harvestWindowDays.min <= harvestAfterDays &&
          harvestAfterDays <= harvestWindowDays.max,
      }).toEqual({ id: crop.id, ok: true });
    }
  });

  it('作業は日数順で、収穫の目安より前（4.19）', () => {
    for (const crop of CROP_MASTER) {
      const days = crop.guide.tasks.map((task) => task.afterDays);
      expect({ id: crop.id, days }).toEqual({ id: crop.id, days: [...days].sort((a, b) => a - b) });
      for (const task of crop.guide.tasks) {
        expect({ id: crop.id, task: task.kind, ok: task.afterDays >= 1 }).toEqual({
          id: crop.id,
          task: task.kind,
          ok: true,
        });
        if (crop.guide.harvestAfterDays != null) {
          expect({
            id: crop.id,
            task: task.kind,
            ok:
              task.afterDays <= crop.guide.harvestAfterDays + (crop.guide.harvestDurationDays ?? 0),
          }).toEqual({ id: crop.id, task: task.kind, ok: true });
        }
      }
    }
  });

  it('適温は 最低 ≤ 最高、追肥間隔・水やり間隔・連作年数は 0 以上（4.19）', () => {
    for (const crop of CROP_MASTER) {
      const { temperature, fertilizeIntervalDays, wateringIntervalDays, rotationYears } =
        crop.guide;
      if (temperature) {
        expect(temperature.germination[0]).toBeLessThanOrEqual(temperature.germination[1]);
        expect(temperature.growth[0]).toBeLessThanOrEqual(temperature.growth[1]);
      }
      if (fertilizeIntervalDays != null) expect(fertilizeIntervalDays).toBeGreaterThan(0);
      if (wateringIntervalDays != null) expect(wateringIntervalDays).toBeGreaterThan(0);
      if (rotationYears != null) expect(rotationYears).toBeGreaterThanOrEqual(0);
    }
  });

  it('分類は CROP_CATEGORY_ORDER の語彙（4.19）', () => {
    for (const crop of CROP_MASTER) {
      expect({ id: crop.id, ok: CROP_CATEGORY_ORDER.includes(crop.category) }).toEqual({
        id: crop.id,
        ok: true,
      });
    }
  });

  it('出典は 1 つ以上で、すべて CROP_MASTER_REFERENCES に実在する id（4.19 決定②）', () => {
    const ids = new Set(CROP_MASTER_REFERENCES.map((ref) => ref.id));
    expect(ids.size).toBe(CROP_MASTER_REFERENCES.length);
    for (const crop of CROP_MASTER) {
      expect({ id: crop.id, n: crop.sourceIds.length > 0 }).toEqual({ id: crop.id, n: true });
      for (const sourceId of crop.sourceIds) {
        expect({ id: crop.id, sourceId, ok: ids.has(sourceId) }).toEqual({
          id: crop.id,
          sourceId,
          ok: true,
        });
      }
    }
    // 使われていない出典が無い（消し忘れの検出）
    const used = new Set(CROP_MASTER.flatMap((crop) => crop.sourceIds));
    for (const ref of CROP_MASTER_REFERENCES) {
      expect({ ref: ref.id, used: used.has(ref.id) }).toEqual({ ref: ref.id, used: true });
    }
  });

  it('referencesFor / findCropMaster', () => {
    expect(referencesFor(['maff-sehi', 'nothing']).map((ref) => ref.id)).toEqual(['maff-sehi']);
    expect(findCropMaster('crop-kushinsai')?.name).toBe('空芯菜');
    expect(findCropMaster('crop-nothing')).toBeUndefined();
  });

  it('編集者判断: プランター可なら深さが入っている', () => {
    for (const crop of CROP_MASTER) {
      if (crop.editorial.container.ok) {
        expect({ id: crop.id, ok: crop.editorial.container.depthCm > 0 }).toEqual({
          id: crop.id,
          ok: true,
        });
      }
    }
  });

  it('ガイドの文言と株間が入っている', () => {
    for (const crop of CROP_MASTER) {
      expect(crop.guide.spacingCm).toBeGreaterThan(0);
      expect(crop.guide.wateringNote.length).toBeGreaterThan(0);
      expect(crop.guide.tips.length).toBeGreaterThan(0);
      expect(crop.guide.commonPests.length).toBeGreaterThan(0);
    }
  });

  it('50 品目そろっている（WBS 3.1 の 30 + 4.19 第 1 段の 20）', () => {
    expect(CROP_MASTER.length).toBe(50);
    expect(CROP_MASTER_VERSION).toBeGreaterThanOrEqual(4);
    // 発端になった 2 つと、別名表が先回りしていた 3 つが入っている
    for (const name of ['ルッコラ', '空芯菜', 'トウガラシ', 'インゲン', 'サヤエンドウ']) {
      expect(CROP_MASTER.some((crop) => crop.name === name)).toBe(true);
    }
    // 多年草は 2 つ（ニラ・ミョウガ）で型を通す
    expect(CROP_MASTER.filter((crop) => crop.perennial).map((crop) => crop.name)).toEqual([
      'ニラ',
      'ミョウガ',
    ]);
    // マスターの中身を変えたら版を上げる（据え置くと配布済み端末に反映されない）
    expect(CROP_MASTER_VERSION).toBeGreaterThanOrEqual(5);
  });

  // ── 4.19 レビュー 24: 多年草を boolean で表せない ────────────────────────
  it('多年草は収穫日数を持たず、いつから採れるかを持つ', () => {
    for (const crop of CROP_MASTER) {
      if (!crop.perennial) {
        // 多年草でなければ収穫の幅は必須（進行帯が窓を描けない品目を作らない）
        expect({ id: crop.id, window: crop.guide.harvestWindowDays != null }).toEqual({
          id: crop.id,
          window: true,
        });
        continue;
      }
      expect({ id: crop.id, harvestAfterDays: crop.guide.harvestAfterDays }).toEqual({
        id: crop.id,
        harvestAfterDays: null,
      });
      expect({ id: crop.id, window: crop.guide.harvestWindowDays }).toEqual({
        id: crop.id,
        window: null,
      });
      expect(Object.keys(PERENNIAL_FIRST_HARVEST_LABEL)).toContain(crop.perennial.firstHarvest);
    }
  });

  it('ミョウガの札と tips が食い違わない（植えた年から採れる）', () => {
    const myoga = crop('crop-myoga');
    expect(myoga.perennial?.firstHarvest).toBe('same-year');
    // 「翌年から収穫」と書くと tips（植えた年は 9 月から）と矛盾する
    expect(perennialNoticeFor(myoga)).toContain('植えた年から収穫');
    expect(myoga.guide.tips).toContain('植えた年は 9 月から');

    const nira = crop('crop-nira');
    expect(nira.perennial?.firstHarvest).toBe('next-year');
    expect(perennialNoticeFor(nira)).toContain('翌年から収穫');

    // 多年草でなければ注記は出さない
    expect(perennialNoticeFor(crop('crop-tomato'))).toBeNull();
  });

  it("ミョウガは根もの。'tree' は果樹だけの節に戻した", () => {
    expect(findCropMaster('crop-myoga')?.category).toBe('root');
    expect(CROP_CATEGORY_LABEL.tree).toBe('果樹');
    // 多年草かどうかは perennial が持つ。分類に混ぜない
    expect(CROP_MASTER.filter((crop) => crop.category === 'tree')).toEqual([]);
  });

  // ── 4.19 レビュー 30: 適温に気温と地温が混ざっていた ─────────────────────
  it('種から始めない品目の適温は地温（萌芽）基準', () => {
    const soil = CROP_MASTER.filter((crop) => crop.guide.temperature?.basis === 'soil');
    expect(soil.map((crop) => crop.name)).toEqual([
      'ニンニク',
      'ジャガイモ',
      'ショウガ',
      'サトイモ',
      'ミョウガ',
    ]);

    // 地温基準になるのは「種いも・鱗片・根株から直に植える」品目 =
    // 種まきの窓が無く（sow なし）、育苗期間も持たない（transplantAfterDays が null）のに
    // 発芽（萌芽）日数だけ持つもの。レタスのように苗を育ててから植える品目は
    // 育苗期間を持つので気温基準のまま。品目が増えてもこの不変条件で漏れを捕まえられる
    for (const crop of CROP_MASTER) {
      if (!crop.guide.temperature) continue;
      const sprouts =
        crop.calendars.every((w) => w.kind !== 'sow') && crop.guide.transplantAfterDays == null;
      const expected = sprouts && crop.guide.germinationDays != null ? 'soil' : 'air';
      expect({ id: crop.id, basis: crop.guide.temperature.basis }).toEqual({
        id: crop.id,
        basis: expected,
      });
    }
  });

  // ── 4.19 レビュー 28: 情報量と出典の下限 ─────────────────────────────────
  it('どの作物も公的資料（農水省・県・JA・普及協会）の出典を 1 つ以上持つ', () => {
    // 種苗会社の資料だけで書かれた作物を作らない（決定③）
    const isPublic = (publisher: string) =>
      publisher === '農林水産省' ||
      publisher === '全国農業改良普及支援協会' ||
      publisher.endsWith('県') ||
      publisher.startsWith('JA');

    for (const crop of CROP_MASTER) {
      const publishers = referencesFor(crop.sourceIds).map((ref) => ref.publisher);
      expect({ id: crop.id, ok: publishers.some(isPublic) }).toEqual({ id: crop.id, ok: true });
    }
    // 種苗会社の資料も実際に使われている（決定③の例外が生きている）
    expect(CROP_MASTER_REFERENCES.some((ref) => !isPublic(ref.publisher))).toBe(true);
  });

  it('出典の見出しはその作物の発行元から組み立てる', () => {
    // ミョウガの出典は普及協会 1 件だけ。全体の脚注（農水省・JA…）を出さない
    expect(attributionFor(crop('crop-myoga').sourceIds)).toBe(
      '全国農業改良普及支援協会の公開資料をもとにした目安です',
    );
    // 同じ発行元の資料を 2 件持っていても 1 回だけ出す
    expect(attributionFor(['saitama-satoimo', 'saitama-shoga'])).toBe(
      '埼玉県の公開資料をもとにした目安です',
    );
    // 引けないときだけ全体の脚注へ落とす
    expect(attributionFor(['nothing'])).toBe(CROP_MASTER_ATTRIBUTION);

    for (const ref of CROP_MASTER_REFERENCES) {
      expect({ id: ref.id, ok: ref.publisher.length > 0 }).toEqual({ id: ref.id, ok: true });
    }
  });

  it('2 期作の作物がある（同 kind 2 窓が実際に使われている）', () => {
    const dual = CROP_MASTER.filter((crop) =>
      REGIONS.some((region) =>
        (['sow', 'plant', 'harvest'] as const).some(
          (kind) =>
            crop.calendars.filter((w) => w.region === region && w.kind === kind).length === 2,
        ),
      ),
    );
    expect(dual.map((crop) => crop.id)).toEqual(
      expect.arrayContaining(['crop-jagaimo', 'crop-retasu']),
    );
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('syncCropMaster (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
  });

  afterEach(() => mockHandles.close());

  function countOf(table: string): number {
    return mockHandles.expoDb.getAllSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
  }

  it('マスターを丸ごと投入する', async () => {
    await syncCropMaster(mockHandles.db);

    expect(countOf('crops')).toBe(CROP_MASTER.length);
    expect(countOf('crop_guides')).toBe(CROP_MASTER.length);
    expect(countOf('crop_calendars')).toBe(
      CROP_MASTER.reduce((sum, crop) => sum + crop.calendars.length, 0),
    );
  });

  it('2 回呼んでも増えない（バージョンで同期をスキップ）', async () => {
    await syncCropMaster(mockHandles.db);
    const before = countOf('crop_calendars');

    await syncCropMaster(mockHandles.db);

    expect(countOf('crop_calendars')).toBe(before);
  });

  it('マスター外の作物（開発用サンプル）は消さない', async () => {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO crops (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['crop-sample', 'サンプル', now, now],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO crop_calendars (id, crop_id, region, kind, start_month, end_month) VALUES (?, ?, ?, ?, ?, ?)',
      ['cal-sample', 'crop-sample', 'temperate', 'sow', 4, 5],
    );

    await syncCropMaster(mockHandles.db);

    expect(countOf('crops')).toBe(CROP_MASTER.length + 1);
    const sample = mockHandles.expoDb.getAllSync<{ id: string }>(
      "SELECT id FROM crop_calendars WHERE crop_id = 'crop-sample'",
    );
    expect(sample).toHaveLength(1);
  });

  it('中間地の 10 月に始めどきの窓がある（v1.0 公開月に「今月の仕事」が空にならない）', async () => {
    await syncCropMaster(mockHandles.db);

    const rows = mockHandles.expoDb.getAllSync<{ crop_id: string }>(
      `SELECT crop_id FROM crop_calendars
       WHERE region = 'temperate' AND kind IN ('sow', 'plant')
         AND ((start_month <= end_month AND 10 BETWEEN start_month AND end_month)
           OR (start_month > end_month AND (10 >= start_month OR 10 <= end_month)))`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('ガイドの虫は JSON 配列で入る', async () => {
    await syncCropMaster(mockHandles.db);

    const [row] = mockHandles.expoDb.getAllSync<{ common_pests: string }>(
      "SELECT common_pests FROM crop_guides WHERE crop_id = 'crop-daikon'",
    );
    expect(Array.isArray(JSON.parse(row.common_pests))).toBe(true);
  });

  it('4.19 の列（分類・幅・作業・多年草・編集者判断）が入る', async () => {
    await syncCropMaster(mockHandles.db);

    const [tomato] = mockHandles.expoDb.getAllSync<Record<string, unknown>>(
      `SELECT c.category, g.harvest_window_min_days, g.harvest_window_max_days, g.fertilize_interval_days,
              g.temp_germination_min, g.rotation_years, g.tasks, g.perennial, g.beginner, g.container_ok,
              g.container_depth_cm
       FROM crop_guides g JOIN crops c ON c.id = g.crop_id WHERE g.crop_id = 'crop-tomato'`,
    );
    expect(tomato.category).toBe('fruit');
    expect(tomato.harvest_window_min_days).toBe(50);
    expect(tomato.harvest_window_max_days).toBe(70);
    expect(tomato.fertilize_interval_days).toBe(20);
    expect(tomato.temp_germination_min).toBe(25);
    expect(tomato.rotation_years).toBe(4);
    expect(JSON.parse(tomato.tasks as string).map((t: { kind: string }) => t.kind)).toEqual([
      'stake',
      'sucker',
      'pinch',
    ]);
    expect(tomato.perennial).toBe(0);
    expect(tomato.beginner).toBe(1);
    expect(tomato.container_ok).toBe(1);
    expect(tomato.container_depth_cm).toBe(30);

    const [nira] = mockHandles.expoDb.getAllSync<Record<string, unknown>>(
      "SELECT harvest_after_days, perennial FROM crop_guides WHERE crop_id = 'crop-nira'",
    );
    expect(nira.harvest_after_days).toBeNull();
    expect(nira.perennial).toBe(1);

    const [hakusai] = mockHandles.expoDb.getAllSync<Record<string, unknown>>(
      "SELECT container_ok, container_depth_cm FROM crop_guides WHERE crop_id = 'crop-hakusai'",
    );
    expect(hakusai.container_ok).toBe(0);
    expect(hakusai.container_depth_cm).toBeNull();
  });

  /**
   * 4.19 レビュー 27: マスターの同期は**原子的**でなければならない。
   *
   * 暦とガイドは「消してから入れ直す」ので、途中で落ちたまま版だけ上がると
   * **窓が消えた端末**ができ、次の起動でも同版としてスキップされて直らない。
   * ここでは途中の insert を失敗させ、何も残らず版も上がらないことを見る。
   */
  it('途中で失敗したら何も残らず、版も上がらない（全部入ったときだけ版が上がる）', async () => {
    // db をそのまま前に置いた薄い被せもの。3 回目の insert だけ失敗させる
    const failing = Object.create(mockHandles.db) as typeof mockHandles.db;
    let calls = 0;
    failing.insert = (table: unknown) => {
      calls += 1;
      if (calls === 3) throw new Error('insert に失敗しました');
      return mockHandles.db.insert(table);
    };

    await expect(syncCropMaster(failing)).rejects.toThrow('insert に失敗しました');

    expect(countOf('crops')).toBe(0);
    expect(countOf('crop_calendars')).toBe(0);
    expect(countOf('crop_guides')).toBe(0);
    expect(
      mockHandles.expoDb.getAllSync("SELECT value FROM app_meta WHERE key = 'crop_master_version'"),
    ).toEqual([]);

    // やり直せる（版が上がっていないので次の起動で入る）
    await syncCropMaster(mockHandles.db);
    expect(countOf('crops')).toBe(CROP_MASTER.length);
  });

  it('v3 の端末（列が無い）にも ADD COLUMN で入る — runMigrations が冪等に足す', () => {
    // createTestDb は最新の CREATE TABLE で作るので、ここでは列を落として旧状態を作る
    const db = mockHandles.expoDb;
    db.execSync('ALTER TABLE crops DROP COLUMN category');
    db.execSync('ALTER TABLE crop_guides DROP COLUMN tasks');
    runMigrations(db);
    const cols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(crop_guides)')
      .map((c) => c.name);
    expect(cols).toContain('tasks');
    const cropCols = db.getAllSync<{ name: string }>('PRAGMA table_info(crops)').map((c) => c.name);
    expect(cropCols).toContain('category');
  });
});

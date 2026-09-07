/**
 * 作物マスターの検証（R08/R09 / WBS 3.1）。
 *
 * データの「園芸的な正しさ」は機械では判定できない（レビューで担保する）。
 * ここで止めるのは**構造の崩れ** — 地域帯の抜け・月の範囲外・日数の逆転など、
 * 30 作物を手で書き足していく過程で必ず起きる種類の間違い。
 */
import { REGIONS } from '../../services/region.service';
import {
  CROP_CATEGORY_ORDER,
  CROP_MASTER,
  CROP_MASTER_REFERENCES,
  CROP_MASTER_VERSION,
  findCropMaster,
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

/** `name` はカタカナで書く（crop-master.ts のヘッダの決め） */
const KATAKANA_NAME = /^[ァ-ヶー]+$/;

/**
 * カタカナ以外の表記を許す品目と、その理由。
 *
 * **理由の無い例外は足さない。** 表記が揺れると検索が別名頼みになり、
 * UI の例示（作物ガイドのプレースホルダ）もマスターとずれる（2026-09-07 レビュー 38）。
 */
const NAME_NOTATION_EXCEPTIONS: Record<string, string> = {
  'crop-kushinsai': '種袋・店頭の表記が「空芯菜」で通っている。カタカナ表記は別名で拾う',
  'crop-hanegi': 'ネギは「葉ネギ / 長ネギ」の対で区別する慣用表記。全カタカナだと対が読めない',
  'crop-naganegi': '同上。「ナガネギ」表記は流通でほぼ使われない',
};

/**
 * v4（50 品目）時点の id。**この配列からは消さない。**
 * id は `plantings.crop_id` に保存され、`syncCropMaster` は `crops` 行を消さないので、
 * マスターから品目を落とすと利用者の栽培が参照先を失う（暦も「次の作業」も静かに止まる）。
 */
const FROZEN_CROP_IDS = [
  'crop-daikon',
  'crop-kabu',
  'crop-ninjin',
  'crop-hourensou',
  'crop-komatsuna',
  'crop-shungiku',
  'crop-mizuna',
  'crop-hakusai',
  'crop-kyabetsu',
  'crop-burokkori',
  'crop-tamanegi',
  'crop-ninniku',
  'crop-tomato',
  'crop-cucumber',
  'crop-nasu',
  'crop-piiman',
  'crop-okura',
  'crop-edamame',
  'crop-toumorokoshi',
  'crop-kabocha',
  'crop-goya',
  'crop-zucchini',
  'crop-jagaimo',
  'crop-satsumaimo',
  'crop-ichigo',
  'crop-hanegi',
  'crop-snap-endou',
  'crop-shiso',
  'crop-basil',
  'crop-retasu',
  'crop-rukkora',
  'crop-kushinsai',
  'crop-chingensai',
  'crop-moroheiya',
  'crop-sanchu',
  'crop-karifurawa',
  'crop-radisshu',
  'crop-shoga',
  'crop-togarashi',
  'crop-papurika',
  'crop-suika',
  'crop-ingen',
  'crop-sayaendo',
  'crop-soramame',
  'crop-rakkasei',
  'crop-satoimo',
  'crop-naganegi',
  'crop-nira',
  'crop-paseri',
  'crop-myoga',
];

describe('作物マスターの構造', () => {
  it('id は一意で crop- 始まり', () => {
    const ids = CROP_MASTER.map((crop) => crop.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^crop-[a-z-]+$/);
  });

  it('name はカタカナ。例外は理由つきの許可リストに載っているものだけ', () => {
    const offenders = CROP_MASTER.filter(
      (crop) => !KATAKANA_NAME.test(crop.name) && !(crop.id in NAME_NOTATION_EXCEPTIONS),
    ).map((crop) => `${crop.id}(${crop.name})`);
    expect(offenders).toEqual([]);
  });

  it('表記の例外は実在する品目で、理由が書かれている', () => {
    for (const [id, reason] of Object.entries(NAME_NOTATION_EXCEPTIONS)) {
      const crop = findCropMaster(id);
      expect(`${id}:${crop ? 'あり' : 'なし'}`).toBe(`${id}:あり`);
      // カタカナに直したら例外リストからも消すこと（死んだ例外を残さない）
      expect(`${id}:${KATAKANA_NAME.test(crop?.name ?? '')}`).toBe(`${id}:false`);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('一度出した id は消さない・変えない（plantings.crop_id に保存済み）', () => {
    const ids = new Set(CROP_MASTER.map((crop) => crop.id));
    const missing = FROZEN_CROP_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
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

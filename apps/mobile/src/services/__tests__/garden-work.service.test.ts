/**
 * 今月の菜園仕事を実 SQLite に対してテストする（R08 / WBS 3.2）。
 * 暦は 30 作物マスターそのものを同期して使う — テスト用の別データを
 * 作ると、本物の暦の月またぎ・重複がすり抜ける。
 */
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

import { syncCropMaster } from '../../db/migrate';
import {
  getMonthlyGardenWork,
  isMonthInWindow,
  rankMonthlyWorkCrops,
  type RankedWorkCrop,
} from '../garden-work.service';
import { setRegion } from '../region.service';

describe('isMonthInWindow', () => {
  it('ふつうの窓（4〜6 月）', () => {
    expect(isMonthInWindow(4, 4, 6)).toBe(true);
    expect(isMonthInWindow(6, 4, 6)).toBe(true);
    expect(isMonthInWindow(3, 4, 6)).toBe(false);
    expect(isMonthInWindow(7, 4, 6)).toBe(false);
  });

  it('年またぎの窓（11 月〜翌 2 月）', () => {
    expect(isMonthInWindow(11, 11, 2)).toBe(true);
    expect(isMonthInWindow(12, 11, 2)).toBe(true);
    expect(isMonthInWindow(1, 11, 2)).toBe(true);
    expect(isMonthInWindow(2, 11, 2)).toBe(true);
    expect(isMonthInWindow(3, 11, 2)).toBe(false);
    expect(isMonthInWindow(10, 11, 2)).toBe(false);
  });

  it('1 か月だけの窓（9 月）', () => {
    expect(isMonthInWindow(9, 9, 9)).toBe(true);
    expect(isMonthInWindow(8, 9, 9)).toBe(false);
  });

  it('範囲外の月は常に外', () => {
    expect(isMonthInWindow(0, 1, 12)).toBe(false);
    expect(isMonthInWindow(13, 1, 12)).toBe(false);
  });
});

describe('rankMonthlyWorkCrops', () => {
  function crop(name: string, overrides: Partial<RankedWorkCrop> = {}): RankedWorkCrop {
    return {
      cropId: `crop-${name}`,
      name,
      growing: false,
      lastChance: false,
      beginner: false,
      ...overrides,
    };
  }

  it('①育てている ②今月が窓の最終月 ③初心者向け ④読み仮名（入力順）の順', () => {
    const ranked = rankMonthlyWorkCrops([
      crop('あ'),
      crop('い', { beginner: true }),
      crop('う', { lastChance: true }),
      crop('え', { growing: true }),
      crop('お'),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(['え', 'う', 'い', 'あ', 'お']);
  });

  it('育てている作物は初心者向け＋締切より前に出る（優先度が入れ替わらない）', () => {
    const ranked = rankMonthlyWorkCrops([
      crop('ぜんぶ持ち', { lastChance: true, beginner: true }),
      crop('育てている', { growing: true }),
    ]);
    expect(ranked[0].name).toBe('育てている');
  });

  it('材料が同じなら入力順（＝読み仮名順）のまま', () => {
    const ranked = rankMonthlyWorkCrops([crop('あ'), crop('い'), crop('う')]);
    expect(ranked.map((c) => c.name)).toEqual(['あ', 'い', 'う']);
  });

  it('cropId と name だけに削る（並べ替えの材料は外に出さない）', () => {
    expect(rankMonthlyWorkCrops([crop('あ', { growing: true })])).toEqual([
      { cropId: 'crop-あ', name: 'あ' },
    ]);
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('getMonthlyGardenWork (real SQLite)', () => {
  const FAMILY_ID = 'family-001';

  function seedGrowing(
    id: string,
    cropId: string,
    cropName: string,
    endedAt: string | null = null,
  ) {
    const now = new Date(2026, 8, 1).toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, FAMILY_ID, cropId, cropName, now, 'seedling', endedAt, now, now],
    );
  }

  function seedFamily() {
    const now = new Date(2026, 8, 1).toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user-kei', 'テスト', now, now],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
    );
  }

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  function at(month: number): Date {
    return new Date(2026, month - 1, 15);
  }

  it('8 月の中間地: 秋まきが始まり、夏野菜が採れる', async () => {
    await setRegion('temperate');
    const work = await getMonthlyGardenWork(at(8));

    expect(work.month).toBe(8);
    expect(work.region).toBe('temperate');
    expect(work.sow.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ダイコン', 'カブ', 'ニンジン']),
    );
    // ジャガイモの秋植え（8〜9 月）が 2 窓目から引けている
    expect(work.plant.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ハクサイ', 'ブロッコリー', 'ジャガイモ']),
    );
    expect(work.harvest.map((c) => c.name)).toEqual(
      expect.arrayContaining(['トマト', 'キュウリ', 'ナス']),
    );
  });

  it('1 月の暖地: 年またぎの収穫窓が引ける', async () => {
    await setRegion('warm');
    const work = await getMonthlyGardenWork(at(1));

    // ダイコン(11〜1)・コマツナ(10〜1)・レタス(11〜1) は年またぎ
    expect(work.harvest.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ダイコン', 'コマツナ', 'レタス']),
    );
    // まきどきは真冬なので無い
    expect(work.sow).toEqual([]);
  });

  it('地域で結果が変わる（12 月の種まき: 中間地は無し・寒冷地も無し）', async () => {
    await setRegion('cold');
    const cold = await getMonthlyGardenWork(at(12));
    expect(cold.sow).toEqual([]);
    expect(cold.plant).toEqual([]);
  });

  it('地域が未設定なら中間地として引く', async () => {
    const work = await getMonthlyGardenWork(at(8));
    expect(work.region).toBe('temperate');
    expect(work.sow.length).toBeGreaterThan(0);
  });

  it('作物は 1 つの欄に 1 回だけ出る（2 窓あっても重複しない）', async () => {
    await setRegion('temperate');
    // ジャガイモ plant 窓は 2〜3 と 8〜9。それぞれの月で 1 回ずつ
    for (const month of [2, 8]) {
      const work = await getMonthlyGardenWork(at(month));
      const names = work.plant.map((c) => c.name).filter((n) => n === 'ジャガイモ');
      expect(names).toEqual(['ジャガイモ']);
    }
  });

  it('同じ作物は 1 度きり・毎回同じ順番で出る', async () => {
    await setRegion('temperate');
    const first = await getMonthlyGardenWork(at(8));
    const second = await getMonthlyGardenWork(at(8));
    const names = first.sow.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(second.sow.map((c) => c.name)).toEqual(names);
  });

  /**
   * 4.19 レビュー 20 の再発検知。カードは 1 行 6 種で畳むので、
   * 読み仮名順のままだと 9 月の採りどき（20 品目）でトマト・ナスが常に隠れていた。
   */
  it('育てている作物が採りどきの先頭に来る（畳んだ 6 種から落ちない）', async () => {
    await setRegion('temperate');

    const before = await getMonthlyGardenWork(at(9));
    expect(before.harvest.length).toBeGreaterThan(6);
    // 並びの最後 = 何の優先材料も持たない品目。ここが先頭に来れば規則が効いている
    const target = before.harvest[before.harvest.length - 1];

    seedGrowing('p-growing', target.cropId, target.name);
    const after = await getMonthlyGardenWork(at(9));

    expect(after.harvest[0].cropId).toBe(target.cropId);
    expect(after.harvest.slice(0, 6).map((c) => c.cropId)).toContain(target.cropId);
    expect(after.harvest).toHaveLength(before.harvest.length);
  });

  it('終了した栽培は優先しない（畑にもう無いものを先頭に出さない）', async () => {
    await setRegion('temperate');
    const before = await getMonthlyGardenWork(at(9));
    const target = before.harvest[before.harvest.length - 1];

    seedGrowing('p-ended', target.cropId, target.name, new Date(2026, 7, 1).toISOString());
    const after = await getMonthlyGardenWork(at(9));

    expect(after.harvest.map((c) => c.cropId)).toEqual(before.harvest.map((c) => c.cropId));
  });

  it('今月が窓の最終月の作物は、まだ続く作物より前に出る', async () => {
    await setRegion('temperate');
    const names = (await getMonthlyGardenWork(at(9))).harvest.map((c) => c.name);

    // トマトの採りどきは 6〜9 = 9 月が最終月。空芯菜（6〜10）はまだ続く。
    // 読み仮名順（くうしんさい < とまと）のままなら逆になる
    expect(names).toEqual(expect.arrayContaining(['トマト', '空芯菜']));
    expect(names.indexOf('トマト')).toBeLessThan(names.indexOf('空芯菜'));
  });
});

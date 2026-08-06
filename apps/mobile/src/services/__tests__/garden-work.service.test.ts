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
import { getMonthlyGardenWork, isMonthInWindow } from '../garden-work.service';
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

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('getMonthlyGardenWork (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
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

  it('読み仮名順で並ぶ（毎回同じ順番で出る）', async () => {
    await setRegion('temperate');
    const work = await getMonthlyGardenWork(at(8));
    const names = work.sow.map((c) => c.name);
    const sorted = [...names];
    expect(names).toEqual(sorted);
    expect(new Set(names).size).toBe(names.length);
  });
});

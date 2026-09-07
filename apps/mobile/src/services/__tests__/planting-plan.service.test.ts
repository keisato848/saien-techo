/**
 * 作付け計画サービスを実 SQLite に対してテストする（R25 / WBS 4.7・#38）。
 *
 * 月の数え方（年またぎ）と変換の冪等性がこの機能の壊れやすいところなので、
 * 純関数は日付を固定して、DB 側は実 SQL で確かめる。
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
import { getPlantingList } from '../planting.service';
import {
  convertPlanToPlanting,
  createPlantingPlan,
  deletePlantingPlan,
  formatPlannedMonth,
  getPlanMonthSuggestions,
  getPlantingPlan,
  getPlantingPlans,
  getUpcomingPlans,
  monthsUntilPlanned,
  nextYearForMonth,
  planTiming,
  planTimingLabel,
  updatePlantingPlan,
} from '../planting-plan.service';
import { setRegion } from '../region.service';

const FAMILY_ID = 'family-001';

/** 2026-09-15。月の数え方を確かめるので日は中旬に固定する */
const NOW = new Date(2026, 8, 15);

describe('monthsUntilPlanned', () => {
  it('同じ年月は 0', () => {
    expect(monthsUntilPlanned(2026, 9, NOW)).toBe(0);
  });

  it('翌月は 1', () => {
    expect(monthsUntilPlanned(2026, 10, NOW)).toBe(1);
  });

  it('過ぎた月は負になる', () => {
    expect(monthsUntilPlanned(2026, 8, NOW)).toBe(-1);
  });

  it('年をまたいでも数えられる（12月 → 翌1月は 1 か月）', () => {
    const december = new Date(2026, 11, 3);
    expect(monthsUntilPlanned(2027, 1, december)).toBe(1);
    expect(monthsUntilPlanned(2027, 3, NOW)).toBe(6);
  });
});

describe('nextYearForMonth', () => {
  it('今月なら今年', () => {
    expect(nextYearForMonth(9, NOW)).toBe(2026);
  });

  it('先の月なら今年', () => {
    expect(nextYearForMonth(11, NOW)).toBe(2026);
  });

  it('過ぎた月なら来年', () => {
    expect(nextYearForMonth(4, NOW)).toBe(2027);
  });
});

describe('formatPlannedMonth', () => {
  it('同じ年なら年を省く', () => {
    expect(formatPlannedMonth(2026, 3, NOW)).toBe('3月');
  });

  it('違う年なら年を付ける', () => {
    expect(formatPlannedMonth(2027, 3, NOW)).toBe('2027年3月');
  });
});

describe('planTiming / planTimingLabel', () => {
  it('過ぎたものは past。断定せず「過ぎています」と伝える', () => {
    expect(planTiming(-2)).toBe('past');
    expect(planTimingLabel(-2)).toBe('予定の月を過ぎています');
  });

  it('今月・来月・その先', () => {
    expect(planTimingLabel(0)).toBe('今月が予定');
    expect(planTimingLabel(1)).toBe('来月が予定');
    expect(planTimingLabel(5)).toBe('あと5か月');
    expect(planTiming(5)).toBe('later');
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('planting-plan.service (real SQLite)', () => {
  function seedFamily(): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user-kei', 'テスト', now, now],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
    );
  }

  function seedPlace(id: string, name: string): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO places (id, family_id, name, kind, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, FAMILY_ID, name, 'row', 1, now, now],
    );
  }

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  describe('createPlantingPlan', () => {
    it('登録して取り出せる', async () => {
      seedPlace('place-1', '南の畝');
      const id = await createPlantingPlan({
        cropName: 'ソラマメ',
        variety: '一寸',
        placeId: 'place-1',
        plannedYear: 2026,
        plannedMonth: 10,
        plannedKind: 'sow',
        note: '種を買っておく',
      });

      const plan = await getPlantingPlan(id, NOW);
      expect(plan).toEqual(
        expect.objectContaining({
          cropName: 'ソラマメ',
          variety: '一寸',
          placeId: 'place-1',
          placeName: '南の畝',
          plannedYear: 2026,
          plannedMonth: 10,
          plannedKind: 'sow',
          note: '種を買っておく',
          plantingId: null,
          monthsUntil: 1,
        }),
      );
    });

    it('作物名をマスターへ寄せて cropId と読みを埋める', async () => {
      const id = await createPlantingPlan({
        cropName: 'ミニトマト',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      const plan = await getPlantingPlan(id, NOW);
      // 「ミニトマト」は別名でトマトに寄る（crop-match.service）
      expect(plan?.cropId).toBe('crop-tomato');
      expect(plan?.cropNameReading).toBe('とまと');
      // 表示名は入力したままにする。勝手に「トマト」へ書き換えない
      expect(plan?.cropName).toBe('ミニトマト');
    });

    it('マスターに無い作物でも登録できる（自由入力を禁じない）', async () => {
      const id = await createPlantingPlan({
        cropName: 'ヤーコン',
        plannedYear: 2027,
        plannedMonth: 4,
        plannedKind: 'plant',
      });

      const plan = await getPlantingPlan(id, NOW);
      expect(plan?.cropId).toBeNull();
      expect(plan?.cropName).toBe('ヤーコン');
    });

    it('空のメモ・品種は null にする', async () => {
      const id = await createPlantingPlan({
        cropName: 'ナス',
        variety: '   ',
        note: '',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      const plan = await getPlantingPlan(id, NOW);
      expect(plan?.variety).toBeNull();
      expect(plan?.note).toBeNull();
    });
  });

  describe('getPlantingPlans', () => {
    it('予定の近い順に並べ、年をまたいでも正しく並ぶ', async () => {
      await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });
      await createPlantingPlan({
        cropName: 'ダイコン',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'sow',
      });
      await createPlantingPlan({
        cropName: 'タマネギ',
        plannedYear: 2026,
        plannedMonth: 11,
        plannedKind: 'plant',
      });

      const plans = await getPlantingPlans({}, NOW);
      expect(plans.map((plan) => plan.cropName)).toEqual(['ダイコン', 'タマネギ', 'ナス']);
    });

    it('既定では変換済みを混ぜない', async () => {
      const kept = await createPlantingPlan({
        cropName: 'ダイコン',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'sow',
      });
      const converted = await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'plant',
      });
      await convertPlanToPlanting(converted);

      expect((await getPlantingPlans({}, NOW)).map((plan) => plan.id)).toEqual([kept]);
      expect((await getPlantingPlans({ onlyConverted: true }, NOW)).map((plan) => plan.id)).toEqual(
        [converted],
      );
    });
  });

  describe('getUpcomingPlans', () => {
    it('今月・来月と、過ぎたものを返す（先の予定は返さない）', async () => {
      await createPlantingPlan({
        cropName: 'ソラマメ',
        plannedYear: 2026,
        plannedMonth: 7,
        plannedKind: 'sow',
      });
      await createPlantingPlan({
        cropName: 'ダイコン',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'sow',
      });
      await createPlantingPlan({
        cropName: 'タマネギ',
        plannedYear: 2026,
        plannedMonth: 10,
        plannedKind: 'plant',
      });
      await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      const upcoming = await getUpcomingPlans(NOW);
      // 忘れたまま消えるのが一番困るので、過ぎたものを先頭に残す
      expect(upcoming.map((plan) => plan.cropName)).toEqual(['ソラマメ', 'ダイコン', 'タマネギ']);
    });
  });

  describe('updatePlantingPlan', () => {
    it('作物名を変えたら cropId も引き直す', async () => {
      const id = await createPlantingPlan({
        cropName: 'トマト',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });
      expect((await getPlantingPlan(id, NOW))?.cropId).toBe('crop-tomato');

      await updatePlantingPlan(id, {
        cropName: 'ナス',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      const plan = await getPlantingPlan(id, NOW);
      expect(plan?.cropName).toBe('ナス');
      expect(plan?.cropId).toBe('crop-nasu');
    });

    it('予定の年月を動かせる', async () => {
      const id = await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      await updatePlantingPlan(id, {
        cropName: 'ナス',
        plannedYear: 2026,
        plannedMonth: 10,
        plannedKind: 'sow',
      });

      const plan = await getPlantingPlan(id, NOW);
      expect(plan?.plannedYear).toBe(2026);
      expect(plan?.plannedMonth).toBe(10);
      expect(plan?.plannedKind).toBe('sow');
    });
  });

  describe('deletePlantingPlan', () => {
    it('消える', async () => {
      const id = await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2027,
        plannedMonth: 5,
        plannedKind: 'plant',
      });

      await deletePlantingPlan(id);
      expect(await getPlantingPlan(id, NOW)).toBeNull();
    });
  });

  describe('convertPlanToPlanting', () => {
    it('作物・品種・場所・メモを引き継いだ栽培を作る', async () => {
      seedPlace('place-1', '南の畝');
      const id = await createPlantingPlan({
        cropName: 'ナス',
        variety: '千両二号',
        placeId: 'place-1',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'plant',
        note: '去年より早めに',
      });

      const plantingId = await convertPlanToPlanting(id, {
        plantedOn: '2026-09-15T00:00:00.000Z',
      });

      const plantings = await getPlantingList();
      expect(plantings).toHaveLength(1);
      expect(plantings[0]).toEqual(
        expect.objectContaining({
          id: plantingId,
          cropName: 'ナス',
          variety: '千両二号',
          placeName: '南の畝',
          // 植え付けの計画は苗から（PLAN_KIND_TO_PLANTED_AS）
          plantedAs: 'seedling',
        }),
      );
    });

    it('種まきの計画は「種から」で登録する', async () => {
      const id = await createPlantingPlan({
        cropName: 'ダイコン',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'sow',
      });

      await convertPlanToPlanting(id);
      expect((await getPlantingList())[0].plantedAs).toBe('seed');
    });

    it('計画は消さず、実績として栽培に紐づける', async () => {
      const id = await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'plant',
      });

      const plantingId = await convertPlanToPlanting(id);

      const plan = await getPlantingPlan(id, NOW);
      expect(plan?.plantingId).toBe(plantingId);
      expect(plan?.convertedAt).not.toBeNull();
    });

    it('2 度押しても栽培は 1 件のまま（同じ id を返す）', async () => {
      const id = await createPlantingPlan({
        cropName: 'ナス',
        plannedYear: 2026,
        plannedMonth: 9,
        plannedKind: 'plant',
      });

      const first = await convertPlanToPlanting(id);
      const second = await convertPlanToPlanting(id);

      expect(second).toBe(first);
      expect(await getPlantingList()).toHaveLength(1);
    });

    it('無い計画は失敗する', async () => {
      await expect(convertPlanToPlanting('missing')).rejects.toThrow('計画が見つかりませんでした');
    });
  });

  describe('getPlanMonthSuggestions', () => {
    it('作物の暦から、まきどき・植えどきを次に来る年で出す', async () => {
      await setRegion('temperate');

      const suggestions = await getPlanMonthSuggestions('トマト', NOW);

      expect(suggestions.length).toBeGreaterThan(0);
      // 収穫の窓は予定に使わないので落とす
      expect(suggestions.every((s) => s.kind === 'sow' || s.kind === 'plant')).toBe(true);
      for (const suggestion of suggestions) {
        expect(suggestion.year).toBe(nextYearForMonth(suggestion.startMonth, NOW));
      }
    });

    it('マスターに無い作物では候補を出さない（月を手で選ぶ形に戻す）', async () => {
      expect(await getPlanMonthSuggestions('ヤーコン', NOW)).toEqual([]);
    });

    it('作物名が空なら候補なし', async () => {
      expect(await getPlanMonthSuggestions('', NOW)).toEqual([]);
    });
  });
});

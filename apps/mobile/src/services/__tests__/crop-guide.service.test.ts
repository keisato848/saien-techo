/**
 * 作物ガイドを実 SQLite に対してテストする（R09 / WBS 3.3）。
 * データは 30 作物マスターそのものを同期して使う。
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

import { CROP_MASTER } from '../../db/crop-master';
import { syncCropMaster } from '../../db/migrate';
import { formatMonthRange, getCropGuideDetail, getCropGuideList } from '../crop-guide.service';
import { setRegion } from '../region.service';

describe('formatMonthRange', () => {
  it('同じ月は 1 つで出す', () => {
    expect(formatMonthRange(9, 9)).toBe('9月');
  });

  it('ふつうの範囲', () => {
    expect(formatMonthRange(4, 6)).toBe('4〜6月');
  });

  it('年またぎは「翌」を付ける', () => {
    expect(formatMonthRange(10, 2)).toBe('10月〜翌2月');
    expect(formatMonthRange(11, 1)).toBe('11月〜翌1月');
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('crop-guide.service (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  function at(month: number): Date {
    return new Date(2026, month - 1, 15);
  }

  describe('getCropGuideList', () => {
    it('全品目を読み仮名順で返す（分類・多年草・編集者判断つき）', async () => {
      const list = await getCropGuideList(at(8));

      expect(list).toHaveLength(CROP_MASTER.length);
      const readings = list.map((c) => c.nameReading ?? '');
      expect(readings).toEqual([...readings].sort());
      const nira = list.find((c) => c.cropId === 'crop-nira');
      expect(nira).toEqual(
        expect.objectContaining({
          category: 'allium',
          perennial: true,
          beginner: true,
          containerOk: true,
        }),
      );
      expect(list.find((c) => c.cropId === 'crop-hakusai')?.containerOk).toBe(false);
    });

    it('8 月の中間地: ダイコンは始めどき・トマトは採りどき', async () => {
      await setRegion('temperate');
      const list = await getCropGuideList(at(8));
      const byId = new Map(list.map((c) => [c.cropId, c]));

      expect(byId.get('crop-daikon')?.startNow).toBe(true);
      expect(byId.get('crop-daikon')?.harvestNow).toBe(false);
      expect(byId.get('crop-tomato')?.harvestNow).toBe(true);
      expect(byId.get('crop-tomato')?.startNow).toBe(false);
    });

    it('地域で印が変わる（8 月の寒冷地はハクサイの植えどき）', async () => {
      await setRegion('cold');
      const list = await getCropGuideList(at(8));
      const hakusai = list.find((c) => c.cropId === 'crop-hakusai');

      expect(hakusai?.startNow).toBe(true);
    });

    it('ガイドの無い作物（開発サンプルの残骸）は一覧に出さない', async () => {
      const now = new Date().toISOString();
      mockHandles.expoDb.runSync(
        'INSERT INTO crops (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['crop-zombie', 'ゾンビ', now, now],
      );

      const list = await getCropGuideList(at(8));
      expect(list.some((c) => c.cropId === 'crop-zombie')).toBe(false);
    });
  });

  describe('getCropGuideDetail', () => {
    it('ダイコン・中間地: 暦とガイドがそろって返る', async () => {
      await setRegion('temperate');
      const detail = await getCropGuideDetail('crop-daikon');

      expect(detail?.name).toBe('ダイコン');
      expect(detail?.family).toBe('アブラナ科');
      expect(detail?.region).toBe('temperate');
      expect(detail?.calendars).toEqual([
        { kind: 'sow', startMonth: 8, endMonth: 9 },
        { kind: 'harvest', startMonth: 10, endMonth: 12 },
      ]);
      expect(detail?.guide?.spacingCm).toBe(25);
      expect(detail?.guide?.commonPests).toContain('アブラムシ');
    });

    it('2 窓の作物は開始月順に並ぶ（ジャガイモ・中間地の plant）', async () => {
      await setRegion('temperate');
      const detail = await getCropGuideDetail('crop-jagaimo');

      const plants = detail?.calendars.filter((c) => c.kind === 'plant') ?? [];
      expect(plants).toEqual([
        { kind: 'plant', startMonth: 2, endMonth: 3 },
        { kind: 'plant', startMonth: 8, endMonth: 9 },
      ]);
    });

    it('kind は まき → 植え → 収穫 の順', async () => {
      await setRegion('cold');
      const detail = await getCropGuideDetail('crop-tamanegi');

      expect(detail?.calendars.map((c) => c.kind)).toEqual(['sow', 'plant', 'harvest']);
    });

    it('存在しない作物は null', async () => {
      expect(await getCropGuideDetail('crop-nothing')).toBeNull();
    });

    it('4.19 の列（幅・適温・作業・編集者判断）と、この作物の出典が返る', async () => {
      const detail = await getCropGuideDetail('crop-tomato');
      expect(detail?.category).toBe('fruit');
      expect(detail?.perennial).toBe(false);
      expect(detail?.guide?.harvestWindow).toEqual({ min: 50, max: 70 });
      expect(detail?.guide?.fertilizeIntervalDays).toBe(20);
      expect(detail?.guide?.temperature).toEqual({ germination: [25, 30], growth: [20, 25] });
      expect(detail?.guide?.rotationYears).toBe(4);
      expect(detail?.guide?.tasks.map((t) => t.kind)).toEqual(['stake', 'sucker', 'pinch']);
      expect(detail?.editorial).toEqual({
        beginner: true,
        containerOk: true,
        containerDepthCm: 30,
      });
      expect(detail?.references.map((r) => r.id)).toEqual([
        'maff-sehi',
        'ja-hokkaido',
        'nagano-kasai-ondo',
        'okinawa-tokusai',
      ]);
    });

    it('多年草（ニラ）は収穫日数と幅が null で perennial=true', async () => {
      const detail = await getCropGuideDetail('crop-nira');
      expect(detail?.perennial).toBe(true);
      expect(detail?.guide?.harvestAfterDays).toBeNull();
      expect(detail?.guide?.harvestWindow).toBeNull();
    });

    it('マスターに無い作物（開発サンプルの残骸）は出典を全体の一覧で返し、編集者判断は null', async () => {
      const now = new Date().toISOString();
      mockHandles.expoDb.runSync(
        'INSERT INTO crops (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['crop-sample', 'サンプル', now, now],
      );
      mockHandles.expoDb.runSync(
        `INSERT INTO crop_guides (crop_id, spacing_cm, harvest_after_days, common_pests) VALUES ('crop-sample', 10, 30, '[]')`,
      );
      const detail = await getCropGuideDetail('crop-sample');
      expect(detail?.references.length).toBeGreaterThan(1);
      expect(detail?.editorial).toBeNull();
      expect(detail?.guide?.tasks).toEqual([]);
    });

    it('壊れた commonPests でも落ちない（空配列で返す）', async () => {
      mockHandles.expoDb.runSync(
        "UPDATE crop_guides SET common_pests = 'こわれた' WHERE crop_id = 'crop-daikon'",
      );

      const detail = await getCropGuideDetail('crop-daikon');
      expect(detail?.guide?.commonPests).toEqual([]);
      expect(detail?.guide?.tips).toBeTruthy();
    });
  });
});

/**
 * 作物マスターの検証（R08/R09 / WBS 3.1）。
 *
 * データの「園芸的な正しさ」は機械では判定できない（レビューで担保する）。
 * ここで止めるのは**構造の崩れ** — 地域帯の抜け・月の範囲外・日数の逆転など、
 * 30 作物を手で書き足していく過程で必ず起きる種類の間違い。
 */
import { REGIONS } from '../../services/region.service';
import { CROP_MASTER, CROP_MASTER_VERSION } from '../crop-master';
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

import { syncCropMaster } from '../migrate';

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

  it('ガイドの日数は 追肥 < 収穫 の順序になっている', () => {
    for (const crop of CROP_MASTER) {
      const { fertilizeAfterDays, harvestAfterDays } = crop.guide;
      expect(harvestAfterDays).toBeGreaterThan(0);
      if (fertilizeAfterDays != null) {
        expect({ id: crop.id, ok: fertilizeAfterDays < harvestAfterDays }).toEqual({
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

  it('秋冬の 12 作物が入っている（3.1b 前半。目標は 30 作物）', () => {
    expect(CROP_MASTER.length).toBeGreaterThanOrEqual(12);
    expect(CROP_MASTER_VERSION).toBeGreaterThanOrEqual(1);
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
});

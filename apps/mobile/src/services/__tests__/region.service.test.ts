/**
 * 地域帯の保存を実 SQLite（app_meta）に対してテストする（§9 / WBS 3.6）。
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

import {
  DEFAULT_REGION,
  getRegion,
  getRegionOrDefault,
  REGION_DESCRIPTION,
  REGION_LABEL,
  REGIONS,
  setRegion,
} from '../region.service';

describe('地域帯の語彙', () => {
  it('3 区分すべてにラベルと説明がある', () => {
    for (const region of REGIONS) {
      expect(REGION_LABEL[region]).toBeTruthy();
      expect(REGION_DESCRIPTION[region]).toBeTruthy();
    }
  });

  it('既定は中間地', () => {
    expect(DEFAULT_REGION).toBe('temperate');
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('region.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
  });

  afterEach(() => mockHandles.close());

  it('未設定なら null（= 聞き取りがまだ）', async () => {
    expect(await getRegion()).toBeNull();
  });

  it('保存して読み戻せる', async () => {
    await setRegion('warm');
    expect(await getRegion()).toBe('warm');
  });

  it('上書きできる（設定からの変更）', async () => {
    await setRegion('cold');
    await setRegion('temperate');
    expect(await getRegion()).toBe('temperate');
  });

  it('未設定でも栽培暦は中間地で引ける', async () => {
    expect(await getRegionOrDefault()).toBe('temperate');
  });

  it('保存済みならその地域で引く', async () => {
    await setRegion('cold');
    expect(await getRegionOrDefault()).toBe('cold');
  });

  it('壊れた値は未設定として扱う（聞き取りをやり直せる）', async () => {
    mockHandles.expoDb.runSync('INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)', [
      'garden_region',
      'こわれた',
      new Date().toISOString(),
    ]);

    expect(await getRegion()).toBeNull();
    expect(await getRegionOrDefault()).toBe(DEFAULT_REGION);
  });
});

/**
 * 成長記録（R16 / WBS 4.4）を実 SQLite に対してテストする。
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

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

// 実機では documentDirectory が入る。ここが null だと resolvePhotoUri が
// 相対パスを素通しするので、解決の検証にならない
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
}));

import { createCareLog } from '../care-log.service';
import { daysBetween, getGrowthPhotos, type GrowthPhoto } from '../growth-compare.service';
import { createHarvest } from '../harvest.service';
import { createPlanting, endPlanting } from '../planting.service';

const FAMILY_ID = 'family-001';
const DOC = 'file:///documents/';

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

async function seedPlanting(): Promise<string> {
  return createPlanting({
    cropName: 'トマト',
    plantedOn: '2026-05-01',
    plantedAs: 'seedling',
    tags: [],
  });
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('growth-compare.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => {
    mockHandles.close();
  });

  it('作業ログと収穫の写真を古い順に並べ、何日目かを付ける', async () => {
    const plantingId = await seedPlanting();
    // 新しい方を先に作っても、返りは古い順になること
    await createHarvest({
      plantingId,
      harvestedAt: '2026-06-20T00:00:00.000Z',
      photoUris: [`${DOC}garden-photos/harvest.jpg`],
    });
    await createCareLog({
      plantingId,
      kind: 'water',
      loggedAt: '2026-05-11T00:00:00.000Z',
      photoUris: [`${DOC}garden-photos/care-1.jpg`, `${DOC}garden-photos/care-2.jpg`],
    });

    const photos = await getGrowthPhotos(plantingId);

    expect(photos).toHaveLength(3);
    expect(photos.map((photo) => photo.source)).toEqual(['care_log', 'care_log', 'harvest']);
    expect(photos[0].elapsedDays).toBe(10);
    expect(photos[2].elapsedDays).toBe(50);
    expect(photos.map((photo) => photo.index)).toEqual([0, 1, 2]);
  });

  it('画面へ渡す URI は解決済み（DB には相対で入っている）', async () => {
    const plantingId = await seedPlanting();
    await createCareLog({
      plantingId,
      kind: 'water',
      loggedAt: '2026-05-11T00:00:00.000Z',
      photoUris: [`${DOC}garden-photos/care-1.jpg`],
    });

    const photos = await getGrowthPhotos(plantingId);
    const stored = mockHandles.expoDb.getAllSync<{ local_path: string }>(
      'SELECT local_path FROM photos',
    );

    // DB は相対（iOS のコンテナ UUID 変化に耐えるため）
    expect(stored[0].local_path).toBe('garden-photos/care-1.jpg');
    // 画面には絶対 URI を渡す（相対のままだと <Image> が描けない）
    expect(photos[0].uri).toContain('garden-photos/care-1.jpg');
    expect(photos[0].uri.startsWith('garden-photos/')).toBe(false);
  });

  it('終了した栽培でも返す（去年育てたものを見返すのがこの機能の主眼）', async () => {
    const plantingId = await seedPlanting();
    await createCareLog({
      plantingId,
      kind: 'water',
      loggedAt: '2026-05-11T00:00:00.000Z',
      photoUris: [`${DOC}garden-photos/a.jpg`],
    });
    await createHarvest({
      plantingId,
      harvestedAt: '2026-06-20T00:00:00.000Z',
      photoUris: [`${DOC}garden-photos/b.jpg`],
    });
    await endPlanting(plantingId, 'harvested', '2026-07-01T00:00:00.000Z');

    const photos = await getGrowthPhotos(plantingId);

    expect(photos).toHaveLength(2);
    // 経過日数は終了日ではなく各記録の日付を基準にする
    expect(photos[0].elapsedDays).toBe(10);
    expect(photos[1].elapsedDays).toBe(50);
  });

  it('写真が 1 枚も無ければ空を返す', async () => {
    const plantingId = await seedPlanting();
    await createCareLog({ plantingId, kind: 'water', loggedAt: '2026-05-11T00:00:00.000Z' });

    expect(await getGrowthPhotos(plantingId)).toEqual([]);
  });

  it('知らない栽培 id では空を返す', async () => {
    expect(await getGrowthPhotos('missing')).toEqual([]);
  });
});

describe('daysBetween', () => {
  it('左右どちらが新しくても正の差を返す', () => {
    const a = { elapsedDays: 10 } as GrowthPhoto;
    const b = { elapsedDays: 50 } as GrowthPhoto;
    expect(daysBetween(a, b)).toBe(40);
    expect(daysBetween(b, a)).toBe(40);
  });
});

/**
 * 作業ログサービスを実 SQLite に対してテストする（R04 / WBS 1.8）。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;
const mockDeletedFiles: string[] = [];

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

// 端末のファイル削除は expo-file-system を叩くのでテストでは記録だけする
jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: (paths: string[]) => {
    mockDeletedFiles.push(...paths);
    return Promise.resolve();
  },
}));

import {
  CARE_KIND_LABEL,
  CARE_KINDS,
  createCareLog,
  deleteCareLog,
  getCareLog,
  getCareLogs,
  QUICK_CARE_KINDS,
  updateCareLog,
} from '../care-log.service';
import { createPlanting, deletePlanting } from '../planting.service';

const FAMILY_ID = 'family-001';

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

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('care-log.service (real SQLite)', () => {
  let plantingId: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    mockDeletedFiles.length = 0;
    seedFamily();
    plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: daysAgoIso(30),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  describe('createCareLog', () => {
    it('種別だけで記録できる（R04 の 1 タップ）', async () => {
      const id = await createCareLog({ plantingId, kind: 'water' });
      const log = await getCareLog(id);

      expect(log?.kind).toBe('water');
      expect(log?.note).toBeNull();
      expect(log?.photoUris).toEqual([]);
    });

    it('日時は未指定なら「今」になる', async () => {
      const before = Date.now();
      const id = await createCareLog({ plantingId, kind: 'water' });
      const log = await getCareLog(id);

      expect(log).not.toBeNull();
      const loggedAt = new Date(log?.loggedAt ?? '').getTime();
      expect(loggedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(loggedAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('日時を明示できる（あとから記録する場合）', async () => {
      const when = daysAgoIso(3);
      const id = await createCareLog({ plantingId, kind: 'fertilize', loggedAt: when });

      expect((await getCareLog(id))?.loggedAt).toBe(when);
    });

    it('メモの前後の空白は落とし、空なら NULL', async () => {
      const withNote = await createCareLog({ plantingId, kind: 'water', note: '  たっぷり  ' });
      const blank = await createCareLog({ plantingId, kind: 'water', note: '   ' });

      expect((await getCareLog(withNote))?.note).toBe('たっぷり');
      expect((await getCareLog(blank))?.note).toBeNull();
    });

    it('写真を付けられ、並び順が保たれる', async () => {
      const id = await createCareLog({
        plantingId,
        kind: 'pest',
        photoUris: ['/a.jpg', '/b.jpg', '/c.jpg'],
      });

      expect((await getCareLog(id))?.photoUris).toEqual(['/a.jpg', '/b.jpg', '/c.jpg']);
    });

    it('写真は 6 枚まで', async () => {
      await expect(
        createCareLog({
          plantingId,
          kind: 'water',
          photoUris: ['/1', '/2', '/3', '/4', '/5', '/6', '/7'],
        }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('getCareLogs', () => {
    it('新しい順に返す', async () => {
      await createCareLog({ plantingId, kind: 'water', loggedAt: daysAgoIso(5) });
      await createCareLog({ plantingId, kind: 'prune', loggedAt: daysAgoIso(1) });
      await createCareLog({ plantingId, kind: 'fertilize', loggedAt: daysAgoIso(10) });

      expect((await getCareLogs(plantingId)).map((log) => log.kind)).toEqual([
        'prune',
        'water',
        'fertilize',
      ]);
    });

    it('他の栽培のログは混ざらない', async () => {
      const other = await createPlanting({
        cropName: 'キュウリ',
        plantedOn: daysAgoIso(10),
        plantedAs: 'seedling',
        tags: [],
      });
      await createCareLog({ plantingId, kind: 'water' });
      await createCareLog({ plantingId: other, kind: 'prune' });

      expect(await getCareLogs(plantingId)).toHaveLength(1);
      expect(await getCareLogs(other)).toHaveLength(1);
    });

    it('複数ログの写真が取り違えられない', async () => {
      const a = await createCareLog({ plantingId, kind: 'water', photoUris: ['/a1', '/a2'] });
      const b = await createCareLog({ plantingId, kind: 'prune', photoUris: ['/b1'] });

      const logs = await getCareLogs(plantingId);
      expect(logs.find((log) => log.id === a)?.photoUris).toEqual(['/a1', '/a2']);
      expect(logs.find((log) => log.id === b)?.photoUris).toEqual(['/b1']);
    });
  });

  describe('updateCareLog', () => {
    it('種別・日時・メモを変えられる', async () => {
      const id = await createCareLog({ plantingId, kind: 'water' });
      const when = daysAgoIso(2);
      await updateCareLog(id, { kind: 'pest', loggedAt: when, note: 'うどんこ病' });

      const log = await getCareLog(id);
      expect(log?.kind).toBe('pest');
      expect(log?.loggedAt).toBe(when);
      expect(log?.note).toBe('うどんこ病');
    });

    it('写真を足せる', async () => {
      const id = await createCareLog({ plantingId, kind: 'water', photoUris: ['/a.jpg'] });
      await updateCareLog(id, { kind: 'water', photoUris: ['/a.jpg', '/b.jpg'] });

      expect((await getCareLog(id))?.photoUris).toEqual(['/a.jpg', '/b.jpg']);
    });

    it('外した写真だけファイルを消し、残す写真には触らない', async () => {
      const id = await createCareLog({
        plantingId,
        kind: 'water',
        photoUris: ['/keep.jpg', '/drop.jpg'],
      });
      mockDeletedFiles.length = 0;

      await updateCareLog(id, { kind: 'water', photoUris: ['/keep.jpg'] });

      expect(mockDeletedFiles).toEqual(['/drop.jpg']);
      expect((await getCareLog(id))?.photoUris).toEqual(['/keep.jpg']);
    });

    it('並べ替えだけならファイルは消えない', async () => {
      const id = await createCareLog({ plantingId, kind: 'water', photoUris: ['/a', '/b'] });
      mockDeletedFiles.length = 0;

      await updateCareLog(id, { kind: 'water', photoUris: ['/b', '/a'] });

      expect(mockDeletedFiles).toEqual([]);
      expect((await getCareLog(id))?.photoUris).toEqual(['/b', '/a']);
    });
  });

  describe('deleteCareLog', () => {
    it('ログと写真の行を消す', async () => {
      const id = await createCareLog({ plantingId, kind: 'water', photoUris: ['/a.jpg'] });
      await deleteCareLog(id);

      expect(await getCareLog(id)).toBeNull();
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(0);
    });

    it('端末のファイルも消す', async () => {
      const id = await createCareLog({
        plantingId,
        kind: 'water',
        photoUris: ['/a.jpg', '/b.jpg'],
      });
      mockDeletedFiles.length = 0;

      await deleteCareLog(id);
      expect(mockDeletedFiles.sort()).toEqual(['/a.jpg', '/b.jpg']);
    });

    it('他のログの写真は消さない', async () => {
      const target = await createCareLog({ plantingId, kind: 'water', photoUris: ['/x.jpg'] });
      await createCareLog({ plantingId, kind: 'prune', photoUris: ['/y.jpg'] });

      await deleteCareLog(target);
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(1);
    });
  });

  it('栽培を削除すると作業ログと写真も消える（FK の確認）', async () => {
    await createCareLog({ plantingId, kind: 'water', photoUris: ['/a.jpg'] });
    await deletePlanting(plantingId);

    expect(mockHandles.expoDb.getAllSync('SELECT id FROM care_logs')).toHaveLength(0);
    expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(0);
  });

  describe('種別の定義', () => {
    it('すべての種別に表示名がある', () => {
      for (const kind of CARE_KINDS) {
        expect(CARE_KIND_LABEL[kind]).toBeTruthy();
      }
    });

    it('クイック記録は全種別の部分集合', () => {
      for (const kind of QUICK_CARE_KINDS) {
        expect(CARE_KINDS).toContain(kind);
      }
      expect(QUICK_CARE_KINDS.length).toBeLessThan(CARE_KINDS.length);
    });

    it('収穫は作業ログの種別に含めない（harvests へ分離）', () => {
      expect(CARE_KINDS).not.toContain('harvest');
    });
  });
});

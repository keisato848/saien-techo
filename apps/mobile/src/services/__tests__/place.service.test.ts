/**
 * 場所サービスを実 SQLite に対してテストする（R02 / WBS 1.6）。
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
  archivePlace,
  createPlace,
  deletePlace,
  getPlace,
  getPlaceDetailList,
  getPlaceList,
  movePlace,
  unarchivePlace,
  updatePlace,
} from '../place.service';
import { createPlanting, endPlanting, getPlantingList } from '../planting.service';

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

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('place.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => mockHandles.close());

  describe('createPlace', () => {
    it('登録して取得できる', async () => {
      const id = await createPlace({ name: '南の畝', kind: 'row', note: '日当たり良好' });
      const place = await getPlace(id);

      expect(place?.name).toBe('南の畝');
      expect(place?.kind).toBe('row');
      expect(place?.note).toBe('日当たり良好');
      expect(place?.archivedAt).toBeNull();
      expect(place?.plantingCount).toBe(0);
    });

    it('前後の空白は落とす', async () => {
      const id = await createPlace({ name: '  ベランダ  ', kind: 'planter', note: '   ' });
      const place = await getPlace(id);

      expect(place?.name).toBe('ベランダ');
      expect(place?.note).toBeNull();
    });

    it('追加した順に並ぶ', async () => {
      await createPlace({ name: 'A', kind: 'planter' });
      await createPlace({ name: 'B', kind: 'row' });
      await createPlace({ name: 'C', kind: 'plot' });

      expect((await getPlaceList()).map((place) => place.name)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('updatePlace', () => {
    it('名前と種類を変えられる', async () => {
      const id = await createPlace({ name: '南の畝', kind: 'row' });
      await updatePlace(id, { name: '南の区画', kind: 'plot', note: 'メモ' });

      const place = await getPlace(id);
      expect(place?.name).toBe('南の区画');
      expect(place?.kind).toBe('plot');
      expect(place?.note).toBe('メモ');
    });
  });

  describe('栽培件数', () => {
    it('育成中と総数を数える', async () => {
      const placeId = await createPlace({ name: '南の畝', kind: 'row' });
      const base = {
        cropName: 'トマト',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling' as const,
        tags: [],
        placeId,
      };
      await createPlanting(base);
      const ended = await createPlanting({ ...base, cropName: 'キュウリ' });
      await endPlanting(ended, 'harvested');

      const place = await getPlace(placeId);
      expect(place?.plantingCount).toBe(2);
      expect(place?.growingCount).toBe(1);
    });

    it('栽培が無い場所は 0 件（集計の左外れを確認）', async () => {
      const used = await createPlace({ name: '使う', kind: 'row' });
      const unused = await createPlace({ name: '使わない', kind: 'planter' });
      await createPlanting({
        cropName: 'トマト',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling',
        tags: [],
        placeId: used,
      });

      expect((await getPlace(unused))?.plantingCount).toBe(0);
      expect((await getPlace(used))?.plantingCount).toBe(1);
    });
  });

  describe('アーカイブ', () => {
    it('アーカイブするとピッカーから消えるが管理一覧には残る', async () => {
      const id = await createPlace({ name: '南の畝', kind: 'row' });
      await archivePlace(id);

      expect(await getPlaceList()).toHaveLength(0);
      expect(await getPlaceDetailList()).toHaveLength(1);
      expect((await getPlace(id))?.archivedAt).not.toBeNull();
    });

    it('戻すとピッカーに再び出る', async () => {
      const id = await createPlace({ name: '南の畝', kind: 'row' });
      await archivePlace(id);
      await unarchivePlace(id);

      expect(await getPlaceList()).toHaveLength(1);
    });

    it('アーカイブしても既存の栽培からは場所名が見える', async () => {
      const placeId = await createPlace({ name: '南の畝', kind: 'row' });
      await createPlanting({
        cropName: 'トマト',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling',
        tags: [],
        placeId,
      });
      await archivePlace(placeId);

      expect((await getPlantingList())[0].placeName).toBe('南の畝');
    });
  });

  describe('deletePlace', () => {
    it('未使用なら物理削除できる', async () => {
      const id = await createPlace({ name: '南の畝', kind: 'row' });

      expect(await deletePlace(id)).toEqual({ deleted: true });
      expect(await getPlaceDetailList()).toHaveLength(0);
    });

    it('栽培に使われていたら削除しない（記録から場所名が消えるため）', async () => {
      const placeId = await createPlace({ name: '南の畝', kind: 'row' });
      await createPlanting({
        cropName: 'トマト',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling',
        tags: [],
        placeId,
      });

      expect(await deletePlace(placeId)).toEqual({ deleted: false });
      expect(await getPlaceDetailList()).toHaveLength(1);
    });

    it('栽培が終了していても削除しない', async () => {
      const placeId = await createPlace({ name: '南の畝', kind: 'row' });
      const plantingId = await createPlanting({
        cropName: 'トマト',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling',
        tags: [],
        placeId,
      });
      await endPlanting(plantingId, 'harvested');

      expect(await deletePlace(placeId)).toEqual({ deleted: false });
    });
  });

  describe('movePlace', () => {
    async function names(): Promise<string[]> {
      return (await getPlaceList()).map((place) => place.name);
    }

    it('上へ入れ替えられる', async () => {
      await createPlace({ name: 'A', kind: 'planter' });
      const b = await createPlace({ name: 'B', kind: 'planter' });
      await createPlace({ name: 'C', kind: 'planter' });

      await movePlace(b, 'up');
      expect(await names()).toEqual(['B', 'A', 'C']);
    });

    it('下へ入れ替えられる', async () => {
      await createPlace({ name: 'A', kind: 'planter' });
      const b = await createPlace({ name: 'B', kind: 'planter' });
      await createPlace({ name: 'C', kind: 'planter' });

      await movePlace(b, 'down');
      expect(await names()).toEqual(['A', 'C', 'B']);
    });

    it('先頭を上へ・末尾を下へ動かしても壊れない', async () => {
      const a = await createPlace({ name: 'A', kind: 'planter' });
      const b = await createPlace({ name: 'B', kind: 'planter' });

      await movePlace(a, 'up');
      await movePlace(b, 'down');
      expect(await names()).toEqual(['A', 'B']);
    });

    it('sort_order が NULL でも並べ替えできる', async () => {
      // シードや将来の移行で NULL が混ざりうる
      const now = new Date().toISOString();
      for (const [id, name] of [
        ['p1', 'A'],
        ['p2', 'B'],
      ]) {
        mockHandles.expoDb.runSync(
          'INSERT INTO places (id, family_id, name, kind, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
          [id, FAMILY_ID, name, 'planter', now, now],
        );
      }

      await movePlace('p2', 'up');
      expect(await names()).toEqual(['B', 'A']);
    });
  });
});

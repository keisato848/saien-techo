/**
 * 栽培サービスを **実 SQLite** に対してテストする（WBS 1.5）。
 *
 * モック実装ではなく本番のマイグレーション SQL を流した DB を使うので、
 * NOT NULL・FK・削除順といった SQL 側の制約もここで踏める。
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

import { getPlaceList } from '../place.service';
import {
  createPlanting,
  deletePlanting,
  elapsedDaysFrom,
  endPlanting,
  getPlantingDetail,
  getPlantingList,
  getPlantingTagNames,
  resumePlanting,
  updatePlanting,
} from '../planting.service';
import { searchPlantingsByFts } from '../fts.service';
import type { SavePlantingInput } from '../types';

const FAMILY_ID = 'family-001';

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const baseInput: SavePlantingInput = {
  cropName: 'トマト',
  cropNameReading: 'とまと',
  variety: 'アイコ',
  plantedOn: daysAgoIso(30),
  plantedAs: 'seedling',
  tags: ['夏野菜'],
};

/** plantings.family_id は families への FK。テストごとに親行を用意する */
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

describeIfSqlite('planting.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => {
    mockHandles.close();
  });

  describe('elapsedDaysFrom', () => {
    it('育成中は今日までの日数を返す', () => {
      expect(elapsedDaysFrom(daysAgoIso(10), null)).toBe(10);
    });

    it('終了後は終了日で止まる', () => {
      // 60日前に植えて 10日前に終了 → 50日
      expect(elapsedDaysFrom(daysAgoIso(60), daysAgoIso(10))).toBe(50);
    });

    it('不正な日付では 0 を返す', () => {
      expect(elapsedDaysFrom('なんらかの文字列', null)).toBe(0);
    });
  });

  describe('createPlanting', () => {
    it('登録して詳細を取得できる', async () => {
      const id = await createPlanting(baseInput);
      const detail = await getPlantingDetail(id);

      expect(detail).not.toBeNull();
      expect(detail?.cropName).toBe('トマト');
      expect(detail?.variety).toBe('アイコ');
      expect(detail?.plantedAs).toBe('seedling');
      expect(detail?.elapsedDays).toBe(30);
      expect(detail?.endedAt).toBeNull();
      expect(detail?.tags).toEqual(['夏野菜']);
    });

    it('マスターに無い作物（cropId なし）も登録できる', async () => {
      const id = await createPlanting({
        cropName: 'アオジソ',
        plantedOn: daysAgoIso(5),
        plantedAs: 'seed',
        tags: [],
      });
      const detail = await getPlantingDetail(id);
      expect(detail?.cropId).toBeNull();
      expect(detail?.cropName).toBe('アオジソ');
    });

    it('空文字の任意項目は NULL として保存する', async () => {
      const id = await createPlanting({
        ...baseInput,
        variety: '   ',
        note: '',
      });
      const detail = await getPlantingDetail(id);
      expect(detail?.variety).toBeNull();
      expect(detail?.note).toBeNull();
    });

    it('同じタグを 2 回指定してもリンクは 1 件', async () => {
      const id = await createPlanting({ ...baseInput, tags: ['夏野菜', '夏野菜', ' 夏野菜 '] });
      const detail = await getPlantingDetail(id);
      expect(detail?.tags).toEqual(['夏野菜']);
    });

    it('FTS に登録され、読みでも引ける', async () => {
      const id = await createPlanting(baseInput);
      expect(await searchPlantingsByFts('とまと')).toContain(id);
      // 正規化でカタカナ → ひらがな。カタカナ入力でも同じ結果になる
      expect(await searchPlantingsByFts('トマト')).toContain(id);
    });
  });

  describe('getPlantingList', () => {
    it('既定では育成中のみ返す', async () => {
      const growing = await createPlanting(baseInput);
      const ended = await createPlanting({ ...baseInput, cropName: 'バジル' });
      await endPlanting(ended, 'harvested');

      const list = await getPlantingList();
      expect(list.map((item) => item.id)).toEqual([growing]);
    });

    it('onlyEnded で終了した栽培だけ返す', async () => {
      await createPlanting(baseInput);
      const ended = await createPlanting({ ...baseInput, cropName: 'バジル' });
      await endPlanting(ended, 'died');

      const list = await getPlantingList({ onlyEnded: true });
      expect(list.map((item) => item.id)).toEqual([ended]);
      expect(list[0].endedReason).toBe('died');
    });

    it('includeEnded で両方返す', async () => {
      await createPlanting(baseInput);
      const ended = await createPlanting({ ...baseInput, cropName: 'バジル' });
      await endPlanting(ended, 'harvested');

      expect(await getPlantingList({ includeEnded: true })).toHaveLength(2);
    });

    it('植え付け日の新しい順に並ぶ', async () => {
      const old = await createPlanting({ ...baseInput, plantedOn: daysAgoIso(90) });
      const recent = await createPlanting({ ...baseInput, plantedOn: daysAgoIso(2) });

      const list = await getPlantingList();
      expect(list.map((item) => item.id)).toEqual([recent, old]);
    });

    it('場所が未設定でも一覧に出る（LEFT JOIN の確認）', async () => {
      await createPlanting({ ...baseInput, placeId: null });
      const list = await getPlantingList();
      expect(list).toHaveLength(1);
      expect(list[0].placeName).toBeNull();
    });

    it('場所を設定すると場所名が載る', async () => {
      const now = new Date().toISOString();
      mockHandles.expoDb.runSync(
        'INSERT INTO places (id, family_id, name, kind, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['place-1', FAMILY_ID, '南の畝', 'row', 1, now, now],
      );
      await createPlanting({ ...baseInput, placeId: 'place-1' });

      const list = await getPlantingList();
      expect(list[0].placeName).toBe('南の畝');
      expect(await getPlaceList()).toEqual([{ id: 'place-1', name: '南の畝', kind: 'row' }]);
    });
  });

  describe('updatePlanting', () => {
    it('項目を書き換えられる', async () => {
      const id = await createPlanting(baseInput);
      await updatePlanting(id, {
        ...baseInput,
        cropName: 'ミニトマト',
        variety: '千果',
        note: '雨よけをつけた',
        tags: ['夏野菜', '鉢植え'],
      });

      const detail = await getPlantingDetail(id);
      expect(detail?.cropName).toBe('ミニトマト');
      expect(detail?.variety).toBe('千果');
      expect(detail?.note).toBe('雨よけをつけた');
      expect(detail?.tags.sort()).toEqual(['夏野菜', '鉢植え']);
    });

    it('タグを減らすとリンクも消える', async () => {
      const id = await createPlanting({ ...baseInput, tags: ['夏野菜', '鉢植え'] });
      await updatePlanting(id, { ...baseInput, tags: ['夏野菜'] });
      expect((await getPlantingDetail(id))?.tags).toEqual(['夏野菜']);
    });

    it('FTS も更新される', async () => {
      const id = await createPlanting(baseInput);
      await updatePlanting(id, { ...baseInput, cropName: 'キュウリ', cropNameReading: 'きゅうり' });

      expect(await searchPlantingsByFts('きゅうり')).toContain(id);
      expect(await searchPlantingsByFts('とまと')).not.toContain(id);
    });
  });

  describe('endPlanting / resumePlanting', () => {
    it('終了すると理由と日付が入る', async () => {
      const id = await createPlanting(baseInput);
      await endPlanting(id, 'harvested');

      const detail = await getPlantingDetail(id);
      expect(detail?.endedAt).not.toBeNull();
      expect(detail?.endedReason).toBe('harvested');
    });

    it('終了を取り消すと育成中に戻る', async () => {
      const id = await createPlanting(baseInput);
      await endPlanting(id, 'died');
      await resumePlanting(id);

      const detail = await getPlantingDetail(id);
      expect(detail?.endedAt).toBeNull();
      expect(detail?.endedReason).toBeNull();
      expect(await getPlantingList()).toHaveLength(1);
    });
  });

  describe('deletePlanting', () => {
    it('物理削除され、詳細も一覧も消える', async () => {
      const id = await createPlanting(baseInput);
      await deletePlanting(id);

      expect(await getPlantingDetail(id)).toBeNull();
      expect(await getPlantingList({ includeEnded: true })).toHaveLength(0);
    });

    it('FTS からも消える', async () => {
      const id = await createPlanting(baseInput);
      await deletePlanting(id);
      expect(await searchPlantingsByFts('とまと')).not.toContain(id);
    });

    it('作業ログ・収穫・写真がぶら下がっていても FK エラーにならない', async () => {
      const id = await createPlanting(baseInput);
      const now = new Date().toISOString();

      mockHandles.expoDb.runSync(
        'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['care-1', id, 'water', now, now, now],
      );
      mockHandles.expoDb.runSync(
        'INSERT INTO harvests (id, planting_id, harvested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['harvest-1', id, now, now, now],
      );
      mockHandles.expoDb.runSync(
        'INSERT INTO reminders (id, planting_id, kind, schedule_kind, hour, minute, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['reminder-1', id, 'water', 'daily', 7, 0, 1, now, now],
      );
      for (const [photoId, ownerType, ownerId] of [
        ['photo-1', 'planting', id],
        ['photo-2', 'care_log', 'care-1'],
        ['photo-3', 'harvest', 'harvest-1'],
      ]) {
        mockHandles.expoDb.runSync(
          'INSERT INTO photos (id, owner_type, owner_id, local_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [photoId, ownerType, ownerId, `/tmp/${photoId}.jpg`, 1, now],
        );
      }

      await deletePlanting(id);

      expect(mockHandles.expoDb.getAllSync('SELECT id FROM care_logs')).toHaveLength(0);
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM harvests')).toHaveLength(0);
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM reminders')).toHaveLength(0);
      expect(mockHandles.expoDb.getAllSync('SELECT planting_id FROM planting_tags')).toHaveLength(
        0,
      );
      // ポリモーフィック参照は FK が張れないぶん、消し漏れが起きやすい
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(0);
    });

    it('他の栽培の写真は消さない', async () => {
      const target = await createPlanting(baseInput);
      const other = await createPlanting({ ...baseInput, cropName: 'バジル' });
      const now = new Date().toISOString();
      mockHandles.expoDb.runSync(
        'INSERT INTO photos (id, owner_type, owner_id, local_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['photo-other', 'planting', other, '/tmp/other.jpg', 1, now],
      );

      await deletePlanting(target);

      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(1);
    });
  });
});

describeIfSqlite('getPlantingTagNames (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });
  afterEach(() => mockHandles.close());

  it('栽培に付いているタグだけを返す（レシピ用のタグは混ぜない）', async () => {
    handlesInsertRecipeOnlyTag();
    await createPlanting({ ...baseInput, tags: ['夏野菜'] });

    expect(await getPlantingTagNames()).toEqual(['夏野菜']);
  });

  it('重複は畳んで名前順に返す', async () => {
    await createPlanting({ ...baseInput, tags: ['実もの', '夏野菜'] });
    await createPlanting({ ...baseInput, cropName: 'キュウリ', tags: ['夏野菜'] });

    expect(await getPlantingTagNames()).toEqual(['夏野菜', '実もの']);
  });

  it('栽培を消すとその栽培だけのタグは候補から外れる', async () => {
    const id = await createPlanting({ ...baseInput, tags: ['ハーブ'] });
    await deletePlanting(id);

    expect(await getPlantingTagNames()).toEqual([]);
  });
});

/** どの栽培にも紐づかない、レシピ側のタグを 1 件だけ作る */
function handlesInsertRecipeOnlyTag(): void {
  mockHandles.expoDb.runSync('INSERT INTO tags (id, family_id, name) VALUES (?, ?, ?)', [
    'tag-recipe',
    FAMILY_ID,
    '揚げ物',
  ]);
}

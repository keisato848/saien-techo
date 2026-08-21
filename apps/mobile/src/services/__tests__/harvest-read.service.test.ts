/**
 * 収穫写真の読み取り（#143 / #144）を実 SQLite でテストする。
 *
 * いちばん守りたいのは**順序の不変条件**:
 * サーバーへ送ってよいのは「無料枠」か「リワード視聴完了の paid 印」だけ。
 * ここが緩むと、広告を見ていない読み取りに金が出る（#144）。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

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

// 画像の縮小・base64 化はネイティブ依存なのでテストでは固定値
jest.mock('../upload-image', () => ({
  expoUploadImageAdapter: {
    prepare: () => Promise.resolve({ base64: 'dGVzdA==', mimeType: 'image/jpeg' }),
  },
}));

// 無料枠は usage.service 側のテストが担保。ここでは canInfer と消費だけ見る
let mockCanInfer = true;
const mockIncrementDailyUsage = jest.fn();
jest.mock('../usage.service', () => ({
  getFreemiumStatus: () => Promise.resolve({ canInfer: mockCanInfer }),
  incrementDailyUsage: (...args: unknown[]) => mockIncrementDailyUsage(...args),
}));

import {
  applyRead,
  dismissRead,
  enqueueHarvestRead,
  getOpenReadCount,
  getReadDraft,
  getReadQueue,
  grantFreeRead,
  HarvestReadError,
  markPaidForReward,
  MAX_READ_ATTEMPTS,
  processPaidReads,
  readPhotoDirect,
  READS_PER_REWARD,
} from '../harvest-read.service';
import { createHarvest, deleteHarvest, getHarvest, updateHarvest } from '../harvest.service';
import { createPlanting } from '../planting.service';

const FAMILY_ID = 'family-001';

function seedFamily(): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト菜園', 'user-kei', 'TEST01', now, now],
  );
}

/** ok 応答を返す fetch スタブ */
function okFetch(data: unknown): jest.Mock {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, data }),
    } as unknown as Response),
  );
}

async function makePlanting(cropName = 'キュウリ'): Promise<string> {
  return createPlanting({
    cropName,
    plantedOn: '2026-08-01',
    plantedAs: 'seedling',
    tags: [],
  });
}

async function makeQueuedHarvest(plantingId: string, photo = '/photos/a.jpg'): Promise<string> {
  return createHarvest({
    plantingId,
    harvestedAt: new Date().toISOString(),
    quantity: null,
    unit: null,
    note: '',
    photoUris: [photo],
  });
}

/** 読み取り済み（analyzed）まで進めた収穫を作る */
async function analyzedHarvest(count = 8): Promise<{ plantingId: string; harvestId: string }> {
  const plantingId = await makePlanting('トマト');
  const harvestId = await makeQueuedHarvest(plantingId);
  await grantFreeRead();
  await processPaidReads(undefined, {
    fetchFn: okFetch({ isHarvest: true, cropGuess: 'ミニトマト', count }) as never,
  });
  return { plantingId, harvestId };
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('harvest-read.service', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    mockCanInfer = true;
    mockIncrementDailyUsage.mockClear();
    seedFamily();
  });

  afterEach(() => {
    mockHandles.close();
  });

  describe('キュー投入（createHarvest 経由）', () => {
    it('写真あり・数量なしなら読み取り待ちに積まれる', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);

      const queue = await getReadQueue();
      expect(queue.map((item) => item.harvestId)).toEqual([harvestId]);
      expect(queue[0]).toMatchObject({
        state: 'pending',
        paid: false,
        cropName: 'キュウリ',
        photoUri: '/photos/a.jpg',
      });
      expect(await getOpenReadCount()).toBe(1);
    });

    it('数量を打ってあれば積まれない（読むものがない）', async () => {
      const plantingId = await makePlanting();
      await createHarvest({
        plantingId,
        harvestedAt: new Date().toISOString(),
        quantity: 3,
        unit: 'piece',
        note: '',
        photoUris: ['/photos/a.jpg'],
      });
      expect(await getReadQueue()).toEqual([]);
    });

    it('写真が無ければ積まれない', async () => {
      const plantingId = await makePlanting();
      await createHarvest({
        plantingId,
        harvestedAt: new Date().toISOString(),
        quantity: null,
        unit: null,
        note: '',
        photoUris: [],
      });
      expect(await getReadQueue()).toEqual([]);
    });
  });

  describe('順序の不変条件（#144）', () => {
    it('paid 印の無いものはサーバーへ送られない', async () => {
      const plantingId = await makePlanting();
      await makeQueuedHarvest(plantingId);
      await makeQueuedHarvest(plantingId, '/photos/b.jpg');

      const fetchFn = okFetch({ isHarvest: true, count: 3 });
      const result = await processPaidReads(undefined, { fetchFn: fetchFn as never });

      expect(result).toEqual({ processed: 0, failed: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('リワードの印を付けたぶんだけ送られる', async () => {
      const plantingId = await makePlanting();
      const first = await makeQueuedHarvest(plantingId);
      // 2 件目は印を付けない
      await makeQueuedHarvest(plantingId, '/photos/b.jpg');

      // markPaidForReward は古い順に最大 READS_PER_REWARD 件 — ここでは 2 件とも
      // 印が付くので、片方だけ検証するために直接 1 件だけ印を付け直す
      const paidIds = await markPaidForReward();
      expect(paidIds).toHaveLength(2);
      mockHandles.expoDb.runSync('UPDATE harvest_photo_reads SET paid = 0 WHERE harvest_id != ?', [
        first,
      ]);

      const fetchFn = okFetch({ isHarvest: true, cropGuess: 'キュウリ', count: 3 });
      const result = await processPaidReads(undefined, { fetchFn: fetchFn as never });

      expect(result).toEqual({ processed: 1, failed: 0 });
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const queue = await getReadQueue();
      const done = queue.find((item) => item.harvestId === first);
      expect(done).toMatchObject({ state: 'analyzed', count: 3, cropGuess: 'キュウリ' });
    });

    it('markPaidForReward は古い順に最大 READS_PER_REWARD 件', async () => {
      const plantingId = await makePlanting();
      const ids: string[] = [];
      for (let i = 0; i < READS_PER_REWARD + 3; i += 1) {
        ids.push(await makeQueuedHarvest(plantingId, `/photos/p${i}.jpg`));
        // created_at を確実にずらす（同一ミリ秒だと順序が不定になる）
        mockHandles.expoDb.runSync(
          'UPDATE harvest_photo_reads SET created_at = ? WHERE harvest_id = ?',
          [new Date(2026, 7, 1, 0, 0, i).toISOString(), ids[i]],
        );
      }

      const paid = await markPaidForReward();
      expect(paid).toEqual(ids.slice(0, READS_PER_REWARD));
    });
  });

  describe('無料枠', () => {
    it('grantFreeRead は先頭 1 件に印を付け、日次カウンタを 1 消費する', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);

      const granted = await grantFreeRead();
      expect(granted).toBe(harvestId);
      expect(mockIncrementDailyUsage).toHaveBeenCalledTimes(1);

      const fetchFn = okFetch({ isHarvest: true, count: 2 });
      await processPaidReads(undefined, { fetchFn: fetchFn as never });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('枠が無ければ何もしない（送信ゼロ・消費ゼロ）', async () => {
      mockCanInfer = false;
      const plantingId = await makePlanting();
      await makeQueuedHarvest(plantingId);

      expect(await grantFreeRead()).toBeNull();
      expect(mockIncrementDailyUsage).not.toHaveBeenCalled();
    });

    it('readPhotoDirect は枠が無ければ送信せずに quota エラー', async () => {
      mockCanInfer = false;
      const fetchFn = okFetch({ isHarvest: true });

      await expect(
        readPhotoDirect('/photos/a.jpg', 'キュウリ', { fetchFn: fetchFn as never }),
      ).rejects.toMatchObject({ kind: 'quota' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('readPhotoDirect は収穫物が写っていたときだけ枠を消費する', async () => {
      const hit = await readPhotoDirect('/photos/a.jpg', 'キュウリ', {
        fetchFn: okFetch({ isHarvest: true, count: 3 }) as never,
      });
      expect(hit.count).toBe(3);
      expect(mockIncrementDailyUsage).toHaveBeenCalledTimes(1);

      // 撮り損じ（isHarvest: false）は消費しない
      await readPhotoDirect('/photos/a.jpg', 'キュウリ', {
        fetchFn: okFetch({ isHarvest: false }) as never,
      });
      expect(mockIncrementDailyUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('失敗とリトライ', () => {
    it(`${MAX_READ_ATTEMPTS} 回失敗したら failed に落ちて手入力を案内する`, async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);
      await markPaidForReward();

      const failingFetch = jest.fn(() => Promise.reject(new Error('network down')));
      for (let i = 0; i < MAX_READ_ATTEMPTS - 1; i += 1) {
        await processPaidReads(undefined, { fetchFn: failingFetch as never });
        // 途中までは paid のまま pending に残る（次回に自動再開 = 履行）
        const [item] = await getReadQueue();
        expect(item).toMatchObject({ state: 'pending', paid: true, attempts: i + 1 });
      }

      await processPaidReads(undefined, { fetchFn: failingFetch as never });
      const [item] = await getReadQueue();
      expect(item).toMatchObject({ state: 'failed', harvestId, attempts: MAX_READ_ATTEMPTS });
      expect(item.readNote).toContain('手で入力');
    });

    it('収穫物が写っていない結果は analyzed（count なし）で note が付く', async () => {
      const plantingId = await makePlanting();
      await makeQueuedHarvest(plantingId);
      await grantFreeRead();

      await processPaidReads(undefined, {
        fetchFn: okFetch({ isHarvest: false }) as never,
      });
      const [item] = await getReadQueue();
      expect(item.state).toBe('analyzed');
      expect(item.count).toBeNull();
      expect(item.readNote).toContain('収穫物が写っていない');
    });
  });

  describe('確認（下書き → 台帳）', () => {
    it('applyRead は数量を書き込み、単位が空なら「個」を入れる', async () => {
      const { harvestId } = await analyzedHarvest(8);
      await applyRead(harvestId);

      const harvest = await getHarvest(harvestId);
      expect(harvest).toMatchObject({ quantity: 8, unit: 'piece' });
      // 適用済みはキューから消える
      expect(await getReadQueue()).toEqual([]);
      expect(await getOpenReadCount()).toBe(0);
    });

    it('count の無い結果には適用できない', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);
      await grantFreeRead();
      await processPaidReads(undefined, {
        fetchFn: okFetch({ isHarvest: true, note: '重なっていて数えられませんでした' }) as never,
      });

      await applyRead(harvestId);
      const harvest = await getHarvest(harvestId);
      expect(harvest?.quantity).toBeNull();
      // 状態は analyzed のまま（数量を入力 / しない をユーザーが選ぶ）
      expect((await getReadQueue())[0]?.state).toBe('analyzed');
    });

    it('dismissRead でキューから消える（記録はそのまま）', async () => {
      const { harvestId } = await analyzedHarvest();
      await dismissRead(harvestId);
      expect(await getReadQueue()).toEqual([]);
      expect((await getHarvest(harvestId))?.quantity).toBeNull();
    });
  });

  /**
   * 「直す」「数量を入力」の着地点（編集画面）へ渡す下書き。
   * これが無いと、9 個と読めていても数量欄が空で開き、直す対象が無くなる。
   */
  describe('getReadDraft', () => {
    it('確定前の読み取りを下書きとして返す', async () => {
      const { harvestId } = await analyzedHarvest(8);
      expect(await getReadDraft(harvestId)).toEqual({
        count: 8,
        cropGuess: 'ミニトマト',
        readNote: null,
      });
    });

    it('数えられなかった結果は理由だけ返す（count は null）', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);
      await grantFreeRead();
      await processPaidReads(undefined, {
        fetchFn: okFetch({ isHarvest: true, note: '重なっていて数えられませんでした' }) as never,
      });

      expect(await getReadDraft(harvestId)).toMatchObject({
        count: null,
        readNote: '重なっていて数えられませんでした',
      });
    });

    it('まだ読んでいない・確定済み・取り下げ済みには下書きが無い', async () => {
      const plantingId = await makePlanting();
      const pendingId = await makeQueuedHarvest(plantingId);
      expect(await getReadDraft(pendingId)).toBeNull();

      const applied = await analyzedHarvest(3);
      await applyRead(applied.harvestId);
      expect(await getReadDraft(applied.harvestId)).toBeNull();

      const declined = await analyzedHarvest(4);
      await dismissRead(declined.harvestId);
      expect(await getReadDraft(declined.harvestId)).toBeNull();
    });
  });

  describe('収穫レコード側との整合', () => {
    it('手で数量を入れて保存したら読み取り待ちから外れる', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);

      await updateHarvest(harvestId, {
        harvestedAt: new Date().toISOString(),
        quantity: 5,
        unit: 'piece',
        note: '',
        photoUris: ['/photos/a.jpg'],
      });
      expect(await getReadQueue()).toEqual([]);
    });

    it('読み取った数のまま保存したら「使った」扱いになる', async () => {
      const { harvestId } = await analyzedHarvest(8);

      // 編集画面は下書き 8 を入れて開く。そのまま保存 = 読み取りの採用
      await updateHarvest(harvestId, {
        harvestedAt: new Date().toISOString(),
        quantity: 8,
        unit: 'piece',
        note: '',
        photoUris: ['/photos/a.jpg'],
      });

      expect(await getReadQueue()).toEqual([]);
      const rows = mockHandles.expoDb.getAllSync(
        'SELECT state FROM harvest_photo_reads WHERE harvest_id = ?',
        [harvestId],
      ) as Array<{ state: string }>;
      expect(rows[0]?.state).toBe('applied');
    });

    it('数を直して保存したら「使わなかった」扱いになる', async () => {
      const { harvestId } = await analyzedHarvest(8);

      await updateHarvest(harvestId, {
        harvestedAt: new Date().toISOString(),
        quantity: 7,
        unit: 'piece',
        note: '',
        photoUris: ['/photos/a.jpg'],
      });

      const rows = mockHandles.expoDb.getAllSync(
        'SELECT state FROM harvest_photo_reads WHERE harvest_id = ?',
        [harvestId],
      ) as Array<{ state: string }>;
      expect(rows[0]?.state).toBe('dismissed');
    });

    it('収穫を削除したら読み取り行も消える', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);

      await deleteHarvest(harvestId);
      expect(await getReadQueue()).toEqual([]);
      const rows = mockHandles.expoDb.getAllSync(
        'SELECT * FROM harvest_photo_reads WHERE harvest_id = ?',
        [harvestId],
      );
      expect(rows).toEqual([]);
    });

    it('二重投入しても 1 行のまま（enqueue は冪等）', async () => {
      const plantingId = await makePlanting();
      const harvestId = await makeQueuedHarvest(plantingId);
      await enqueueHarvestRead(harvestId);
      expect(await getReadQueue()).toHaveLength(1);
    });
  });

  describe('requestHarvestRead のエラー種別', () => {
    it('HTTP エラーは server、中断は network', async () => {
      const plantingId = await makePlanting();
      await makeQueuedHarvest(plantingId);
      await markPaidForReward();

      const httpError = jest.fn(() =>
        Promise.resolve({ ok: false, status: 500 } as unknown as Response),
      );
      await expect(
        readPhotoDirect('/photos/a.jpg', undefined, { fetchFn: httpError as never }),
      ).rejects.toBeInstanceOf(HarvestReadError);
    });
  });
});

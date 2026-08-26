/**
 * 写真からの栽培登録（#139 / #149）を実 SQLite でテストする。
 *
 * いちばん守りたいのは**順序の不変条件**:
 * サーバーへ送ってよいのは、リワードで得た残高を 1 枚ぶん消費できたときだけ。
 * ここが緩むと、広告を見ていない読み取りに推論コストが出る（#144 と同じ理由）。
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

// 残高は identify-credit.service 側のテストが担保。ここでは消費の可否と順序だけ見る。
let mockCredits = 0;
const mockConsume = jest.fn(async () => {
  if (mockCredits <= 0) return false;
  mockCredits -= 1;
  return true;
});
jest.mock('../identify-credit.service', () => ({
  consumeIdentifyCredit: () => mockConsume(),
}));

const mockIdentify = jest.fn();
jest.mock('../planting-identify.service', () => {
  class PlantingIdentifyError extends Error {
    readonly retryable: boolean;
    readonly kind: string;
    constructor(message: string, retryable: boolean, kind = 'transient') {
      super(message);
      this.name = 'PlantingIdentifyError';
      this.retryable = retryable;
      this.kind = kind;
    }
  }
  return {
    PlantingIdentifyError,
    identifyPlanting: (...args: unknown[]) => mockIdentify(...args),
  };
});

import {
  findActivePlantingNames,
  getCropMaster,
  identifyPhotoBatch,
  matchCropMaster,
  MAX_IDENTIFY_BATCH,
  registrableDrafts,
  type PlantingDraft,
} from '../planting-draft.service';
import { PlantingIdentifyError } from '../planting-identify.service';

const MASTER = [
  { id: 'crop-tomato', name: 'トマト', nameReading: 'とまと' },
  { id: 'crop-mini-tomato', name: 'ミニトマト', nameReading: 'みにとまと' },
  { id: 'crop-cucumber', name: 'キュウリ', nameReading: 'きゅうり' },
];

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

beforeEach(() => {
  mockCredits = 0;
  mockConsume.mockClear();
  mockIdentify.mockReset();
});

describe('matchCropMaster', () => {
  it('完全一致を優先する', () => {
    expect(matchCropMaster('ミニトマト', MASTER)).toEqual({
      cropId: 'crop-mini-tomato',
      cropNameReading: 'みにとまと',
    });
  });

  // サーバーには knownCrops を渡してあるので多くは一致するが、
  // 一覧に無い表記が来たときに #149 の「あいまい一致」で拾う。
  it('包含でも拾い、より具体的な作物を優先する', () => {
    // 「中玉ミニトマト」はマスターに無いが、ミニトマト（長い方）に寄せたい
    expect(matchCropMaster('中玉ミニトマト', MASTER).cropId).toBe('crop-mini-tomato');
  });

  it('当たらなければ null のまま（自由入力として登録できる）', () => {
    expect(matchCropMaster('ルッコラ', MASTER)).toEqual({
      cropId: null,
      cropNameReading: null,
    });
  });

  it('空文字は null', () => {
    expect(matchCropMaster('   ', MASTER)).toEqual({ cropId: null, cropNameReading: null });
  });
});

describe('identifyPhotoBatch — 順序の不変条件', () => {
  // これがこの機能の中心。残高ゼロで 1 件でも送ったら金が出る。
  it('残高が無ければ 1 件も送らない', async () => {
    mockCredits = 0;

    const drafts = await identifyPhotoBatch(['a.jpg', 'b.jpg'], undefined, { master: MASTER });

    expect(mockIdentify).not.toHaveBeenCalled();
    expect(drafts).toEqual([
      { imageUri: 'a.jpg', state: 'pending' },
      { imageUri: 'b.jpg', state: 'pending' },
    ]);
  });

  it('残高のぶんだけ送り、尽きた先は pending で残す', async () => {
    mockCredits = 2;
    mockIdentify.mockResolvedValue({ found: true, source: 'plant', cropGuess: 'キュウリ' });

    const drafts = await identifyPhotoBatch(['a.jpg', 'b.jpg', 'c.jpg'], undefined, {
      master: MASTER,
    });

    expect(mockIdentify).toHaveBeenCalledTimes(2);
    expect(drafts.map((d) => d.state)).toEqual(['identified', 'identified', 'pending']);
  });

  // 消費が送信より後だと、中断して再開するたびに無料で送れてしまう。
  it('消費は送信より先に起きる', async () => {
    mockCredits = 1;
    mockIdentify.mockResolvedValue({ found: true, source: 'plant', cropGuess: 'キュウリ' });

    await identifyPhotoBatch(['a.jpg'], undefined, { master: MASTER });

    const consumeOrder = mockConsume.mock.invocationCallOrder[0];
    const identifyOrder = mockIdentify.mock.invocationCallOrder[0];
    expect(consumeOrder).toBeLessThan(identifyOrder);
  });

  it('上限を超える枚数は切り捨てる', async () => {
    mockCredits = 99;
    mockIdentify.mockResolvedValue({ found: true, source: 'plant', cropGuess: 'キュウリ' });

    const many = Array.from({ length: MAX_IDENTIFY_BATCH + 5 }, (_, i) => `p${i}.jpg`);
    const drafts = await identifyPhotoBatch(many, undefined, { master: MASTER });

    expect(drafts).toHaveLength(MAX_IDENTIFY_BATCH);
    expect(mockIdentify).toHaveBeenCalledTimes(MAX_IDENTIFY_BATCH);
  });
});

describe('identifyPhotoBatch — 下書きの中身', () => {
  it('ラベルなら品種と植え方まで下書きに入る', async () => {
    mockCredits = 1;
    mockIdentify.mockResolvedValue({
      found: true,
      source: 'label',
      cropGuess: 'ミニトマト',
      cropConfidence: 'high',
      variety: 'アイコ',
      plantedAs: 'seed',
    });

    const [draft] = await identifyPhotoBatch(['a.jpg'], undefined, { master: MASTER });

    expect(draft).toMatchObject({
      state: 'identified',
      cropName: 'ミニトマト',
      cropId: 'crop-mini-tomato',
      cropNameReading: 'みにとまと',
      variety: 'アイコ',
      plantedAs: 'seed',
      source: 'label',
    });
  });

  it('株なら品種は入らない（サーバーが落としている前提を崩さない）', async () => {
    mockCredits = 1;
    mockIdentify.mockResolvedValue({
      found: true,
      source: 'plant',
      cropGuess: 'キュウリ',
      cropConfidence: 'medium',
    });

    const [draft] = await identifyPhotoBatch(['a.jpg'], undefined, { master: MASTER });

    expect(draft?.cropName).toBe('キュウリ');
    expect(draft?.variety).toBeUndefined();
    expect(draft?.plantedAs).toBeUndefined();
  });

  it('読み取れなかった写真は failed で、手入力へ案内する', async () => {
    mockCredits = 1;
    mockIdentify.mockResolvedValue({ found: false, note: '作物が写っていないようです' });

    const [draft] = await identifyPhotoBatch(['a.jpg'], undefined, { master: MASTER });

    expect(draft?.state).toBe('failed');
    expect(draft?.errorMessage).toContain('手で入力');
    expect(draft?.note).toBe('作物が写っていないようです');
  });

  // 1 枚失敗しても残りを止めない。一括の途中で全部落ちるのが一番困る。
  it('1 枚が失敗しても残りは処理を続ける', async () => {
    mockCredits = 3;
    mockIdentify
      .mockResolvedValueOnce({ found: true, source: 'plant', cropGuess: 'トマト' })
      .mockRejectedValueOnce(new PlantingIdentifyError('通信できませんでした', true, 'offline'))
      .mockResolvedValueOnce({ found: true, source: 'plant', cropGuess: 'キュウリ' });

    const drafts = await identifyPhotoBatch(['a.jpg', 'b.jpg', 'c.jpg'], undefined, {
      master: MASTER,
    });

    expect(drafts.map((d) => d.state)).toEqual(['identified', 'failed', 'identified']);
    expect(drafts[1]?.errorMessage).toBe('通信できませんでした');
  });

  it('進捗を 1 枚ずつ返す', async () => {
    mockCredits = 2;
    mockIdentify.mockResolvedValue({ found: true, source: 'plant', cropGuess: 'キュウリ' });
    const seen: string[] = [];

    await identifyPhotoBatch(
      ['a.jpg', 'b.jpg'],
      (progress) => seen.push(`${progress.done}/${progress.total}`),
      { master: MASTER },
    );

    expect(seen).toEqual(['1/2', '2/2']);
  });

  it('作物マスターを手がかりとしてサービスへ渡す', async () => {
    mockCredits = 1;
    mockIdentify.mockResolvedValue({ found: true, source: 'plant', cropGuess: 'キュウリ' });

    await identifyPhotoBatch(['a.jpg'], undefined, { master: MASTER });

    expect(mockIdentify).toHaveBeenCalledWith(
      expect.objectContaining({ knownCrops: ['トマト', 'ミニトマト', 'キュウリ'] }),
      undefined,
      undefined,
    );
  });
});

describe('registrableDrafts', () => {
  it('作物名が入っているものだけを残す', () => {
    const drafts: PlantingDraft[] = [
      { imageUri: 'a.jpg', state: 'identified', cropName: 'トマト' },
      { imageUri: 'b.jpg', state: 'failed', errorMessage: 'x' },
      { imageUri: 'c.jpg', state: 'pending' },
      { imageUri: 'd.jpg', state: 'identified', cropName: '   ' },
    ];
    expect(registrableDrafts(drafts).map((d) => d.imageUri)).toEqual(['a.jpg']);
  });
});

describeIfSqlite('実 SQLite での参照', () => {
  const FAMILY_ID = 'family-default';

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

  function seedPlanting(id: string, cropName: string, endedAt: string | null): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO plantings (id, family_id, crop_name, planted_on, planted_as, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, FAMILY_ID, cropName, '2026-06-01', 'seedling', endedAt, now, now],
    );
  }

  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => {
    mockHandles.close();
  });

  // 二重登録の注意を出すのに使う。終了した株まで拾うと「もう育てています」が嘘になる。
  it('育成中の栽培名だけを返す（終了したものは含めない）', async () => {
    seedPlanting('p-active', 'トマト', null);
    seedPlanting('p-ended', 'キュウリ', '2026-08-01T00:00:00.000Z');

    const names = await findActivePlantingNames();

    expect(names).toEqual(['トマト']);
  });

  it('作物マスターを ID 接頭辞で絞って返す', async () => {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO crops (id, name, name_reading, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['crop-tomato', 'トマト', 'とまと', now, now],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO crops (id, name, name_reading, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['other-x', 'ダミー', null, now, now],
    );

    const master = await getCropMaster();

    expect(master.map((row) => row.name)).toEqual(['トマト']);
  });
});

/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）。
 *
 * 見るのは 4 つ。
 *
 * 1. **外へ出す材料に、出してはいけないものが混ざらないこと**（場所・メモ）
 * 2. **外へ出るのは焼き込んだカードだけで、原本の写真は絶対に渡らないこと**
 *    — Android は写真とことばを一緒に運べない。原本を渡すと作物名も日付も
 *    アプリ名も落ちるうえ、位置情報を落とす経路も通らない
 * 3. **書き出せなかったときに「採れた」が伝わること**（ことばへ落ちる）
 * 4. **`toDataURL` が返らなくても画面が固まらないこと**（待ち切り）
 *
 * 共有は取り消せない外向きの操作なので、失敗の落とし先を全部固定する。
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

// 実機では documentDirectory が入る。null だと resolvePhotoUri が素通しして
// 「解決されているか」の検証にならない
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import {
  buildShareFileName,
  captureShareCard,
  CARD_TITLE_MAX_LENGTH,
  expoHarvestShareAdapter,
  formatCropTitle,
  formatHarvestAmount,
  formatHarvestDate,
  formatHarvestShareText,
  getHarvestShareCard,
  prepareSharePhoto,
  shareHarvestCard,
  SHARE_PHOTO_MAX_DIMENSION,
  truncateForCard,
  type HarvestShareAdapter,
  type HarvestShareCard,
} from '../harvest-share.service';
import { createHarvest } from '../harvest.service';
import { createPlanting } from '../planting.service';

const FAMILY_ID = 'family-001';
const ORIGINAL_PHOTO = 'file:///documents/garden-photos/a.jpg';
const CARD_FILE = 'file:///cache/share/saien-techo-2026-09-07.jpg';

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

function card(overrides: Partial<HarvestShareCard> = {}): HarvestShareCard {
  return {
    harvestId: 'h1',
    plantingId: 'p1',
    cropName: 'キュウリ',
    variety: null,
    harvestedAt: '2026-09-07T02:00:00.000Z',
    quantity: 3,
    unit: 'piece',
    photoUri: ORIGINAL_PHOTO,
    photoCount: 1,
    ...overrides,
  };
}

interface AdapterCalls {
  sanitized: string[];
  written: [string, string][];
  files: string[];
  texts: string[];
}

function stubAdapter(overrides: Partial<HarvestShareAdapter> = {}): {
  adapter: HarvestShareAdapter;
  calls: AdapterCalls;
} {
  const calls: AdapterCalls = { sanitized: [], written: [], files: [], texts: [] };
  const adapter: HarvestShareAdapter = {
    isSharingAvailable: () => Promise.resolve(true),
    sanitizeImage: (uri) => {
      calls.sanitized.push(uri);
      return Promise.resolve(`${uri}-safe.jpg`);
    },
    writeCardImage: (base64, fileName) => {
      calls.written.push([base64, fileName]);
      return Promise.resolve(CARD_FILE);
    },
    shareFile: (uri) => {
      calls.files.push(uri);
      return Promise.resolve();
    },
    shareText: (message) => {
      calls.texts.push(message);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { adapter, calls };
}

describe('文言の組み立て', () => {
  it('数量と単位を日本語の単位で並べる', () => {
    expect(formatHarvestAmount(3, 'piece')).toBe('3個');
    expect(formatHarvestAmount(1.5, 'kg')).toBe('1.5kg');
    expect(formatHarvestAmount(2, 'bunch')).toBe('2束');
  });

  // 数量は任意入力（R06）。写真だけの収穫でも共有できないと意味がない
  it('数量が無ければ null を返す', () => {
    expect(formatHarvestAmount(null, 'piece')).toBeNull();
  });

  it('単位が無くても数だけは出す', () => {
    expect(formatHarvestAmount(3, null)).toBe('3');
  });

  it('品種があれば括弧で添える', () => {
    expect(formatCropTitle({ cropName: 'キュウリ', variety: '夏すずみ' })).toBe(
      'キュウリ（夏すずみ）',
    );
    expect(formatCropTitle({ cropName: 'キュウリ', variety: '  ' })).toBe('キュウリ');
    expect(formatCropTitle({ cropName: 'キュウリ', variety: null })).toBe('キュウリ');
  });

  it('壊れた日付でも落ちない', () => {
    expect(formatHarvestDate('とれた日')).toBe('');
  });

  /**
   * SVG の `<Text>` は折り返しも省略もしない。畳まずに描くと長い見出しが
   * カードの外へはみ出したまま書き出される。
   */
  it('長い見出しはカードの幅に収まるよう畳む', () => {
    const long = formatCropTitle({ cropName: 'ミニトマト', variety: 'アイコとキャロルの混植' });
    expect(long.length).toBeGreaterThan(CARD_TITLE_MAX_LENGTH);
    expect(truncateForCard(long)).toHaveLength(CARD_TITLE_MAX_LENGTH);
    expect(truncateForCard(long).endsWith('…')).toBe(true);
    // 収まるものは触らない
    expect(truncateForCard('キュウリ')).toBe('キュウリ');
  });

  it('作物名・数量・日付・アプリ名の 3 行になる', () => {
    expect(formatHarvestShareText(card())).toBe(
      [
        'キュウリ 3個 収穫しました',
        formatHarvestDate('2026-09-07T02:00:00.000Z'),
        'さいえん手帳',
      ].join('\n'),
    );
  });

  it('数量が無ければ「を収穫しました」にする', () => {
    expect(formatHarvestShareText(card({ quantity: null, unit: null }))).toContain(
      'キュウリ を収穫しました',
    );
  });

  // iOS の URL(string:) は非 ASCII を弾く。作物名をファイル名へ入れない
  it('書き出しのファイル名は ASCII だけで作る', () => {
    const name = buildShareFileName({ harvestedAt: '2026-09-07T02:00:00.000Z' });
    expect(name).toMatch(/^saien-techo-\d{4}-\d{2}-\d{2}\.jpg$/);
    // eslint-disable-next-line no-control-regex
    expect(name).toMatch(/^[\x00-\x7F]+$/);
  });

  it('壊れた日付でもファイル名は作れる', () => {
    expect(buildShareFileName({ harvestedAt: 'あした' })).toBe('saien-techo-harvest.jpg');
  });
});

describe('captureShareCard', () => {
  it('base64 をそのまま返す', async () => {
    const view = { toDataURL: (cb: (value: string) => void) => cb('BASE64') };
    expect(await captureShareCard(view)).toBe('BASE64');
  });

  it('data: が付いていても中身だけ取り出す', async () => {
    const view = {
      toDataURL: (cb: (value: string) => void) => cb('data:image/png;base64,BASE64'),
    };
    expect(await captureShareCard(view)).toBe('BASE64');
  });

  it('ビューが無ければ null', async () => {
    expect(await captureShareCard(null)).toBeNull();
  });

  it('空文字は書き出せなかった扱いにする', async () => {
    const view = { toDataURL: (cb: (value: string) => void) => cb('') };
    expect(await captureShareCard(view)).toBeNull();
  });

  it('ネイティブ側が投げても null で返す', async () => {
    const view = {
      toDataURL: () => {
        throw new Error('SvgView is not attached');
      },
    };
    expect(await captureShareCard(view)).toBeNull();
  });

  /**
   * `toDataURL` はコールバックが返らないことがある（ビューが外れた、
   * ネイティブ側で落ちた）。待ち切りが無いと共有ボタンを押したまま画面が固まる。
   */
  it('返ってこなければ待ち切って null にする', async () => {
    jest.useFakeTimers();
    try {
      const pending = captureShareCard({ toDataURL: () => undefined }, 1_000);
      jest.advanceTimersByTime(1_000);
      expect(await pending).toBeNull();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('shareHarvestCard', () => {
  it('焼き込んだカードを書き出して共有シートへ渡す', async () => {
    const { adapter, calls } = stubAdapter();

    const outcome = await shareHarvestCard(
      card(),
      { captureCard: () => Promise.resolve('BASE64') },
      adapter,
    );

    expect(outcome).toBe('card');
    expect(calls.written).toEqual([['BASE64', 'saien-techo-2026-09-07.jpg']]);
    expect(calls.files).toEqual([CARD_FILE]);
    expect(calls.texts).toEqual([]);
  });

  /**
   * ここが今回の作り直しの要。Android の ACTION_SEND は写真かことばの
   * 片方しか運べないので、**原本の写真を渡すと作物名も日付もアプリ名も
   * 落ちる**（R28 が主要プラットフォームで丸ごと成立しなくなる）。
   * 外へ出るのは焼き込んだカードだけであること。
   */
  it('原本の写真は決して共有シートへ渡さない', async () => {
    const { adapter, calls } = stubAdapter();

    await shareHarvestCard(card(), { captureCard: () => Promise.resolve('BASE64') }, adapter);

    expect(calls.files).not.toContain(ORIGINAL_PHOTO);
    expect(calls.files.every((uri) => uri === CARD_FILE)).toBe(true);
  });

  it('ことばだけを選んだらカードを書き出さない', async () => {
    const { adapter, calls } = stubAdapter();
    const captureCard = jest.fn(() => Promise.resolve('BASE64'));

    const outcome = await shareHarvestCard(card(), { textOnly: true, captureCard }, adapter);

    expect(outcome).toBe('text');
    expect(captureCard).not.toHaveBeenCalled();
    expect(calls.texts).toEqual([formatHarvestShareText(card())]);
    expect(calls.files).toEqual([]);
  });

  it('書き出せなかったらことばへ落ちる', async () => {
    const { adapter, calls } = stubAdapter();

    const outcome = await shareHarvestCard(
      card(),
      { captureCard: () => Promise.resolve(null) },
      adapter,
    );

    expect(outcome).toBe('text');
    expect(calls.texts).toHaveLength(1);
    expect(calls.files).toEqual([]);
  });

  it('書き出しの途中で落ちてもことばへ落ちる', async () => {
    const { adapter, calls } = stubAdapter({
      writeCardImage: () => Promise.reject(new Error('容量が足りません')),
    });

    const outcome = await shareHarvestCard(
      card(),
      { captureCard: () => Promise.resolve('BASE64') },
      adapter,
    );

    expect(outcome).toBe('text');
    expect(calls.texts).toHaveLength(1);
    expect(calls.files).toEqual([]);
  });

  it('共有シートが使えない端末ではことばへ落ちる', async () => {
    const { adapter, calls } = stubAdapter({ isSharingAvailable: () => Promise.resolve(false) });
    const captureCard = jest.fn(() => Promise.resolve('BASE64'));

    expect(await shareHarvestCard(card(), { captureCard }, adapter)).toBe('text');
    expect(captureCard).not.toHaveBeenCalled();
    expect(calls.texts).toHaveLength(1);
  });

  // 写真の無い収穫でも「ことばだけのカード」は書き出せる（画面が捕まえて渡す）
  it('写真の無い収穫でもカードとして書き出す', async () => {
    const { adapter, calls } = stubAdapter();

    const outcome = await shareHarvestCard(
      card({ photoUri: null, photoCount: 0 }),
      { captureCard: () => Promise.resolve('BASE64') },
      adapter,
    );

    expect(outcome).toBe('card');
    expect(calls.files).toEqual([CARD_FILE]);
  });
});

describe('prepareSharePhoto', () => {
  /**
   * 保存時の圧縮が fail-closed になる前の写真や、古いバックアップから復元した
   * 写真は原本のまま GPS 座標を持っている。**プレビューへ載せる前に**
   * 落とさないと、そのままカードへ焼き込まれて外へ出る。
   */
  it('再エンコードを通した uri を返す', async () => {
    const { adapter, calls } = stubAdapter();

    expect(await prepareSharePhoto(ORIGINAL_PHOTO, adapter)).toBe(`${ORIGINAL_PHOTO}-safe.jpg`);
    expect(calls.sanitized).toEqual([ORIGINAL_PHOTO]);
  });

  it('落とせなければ null（原本を素通しさせない）', async () => {
    const { adapter } = stubAdapter({
      sanitizeImage: () => Promise.reject(new Error('壊れています')),
    });

    expect(await prepareSharePhoto(ORIGINAL_PHOTO, adapter)).toBeNull();
  });
});

describe('expoHarvestShareAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sanitizeImage は JPEG へ再エンコードし、大きすぎる写真は縮める', async () => {
    const result = await expoHarvestShareAdapter.sanitizeImage(ORIGINAL_PHOTO);

    const manipulate = ImageManipulator.manipulate as jest.Mock;
    expect(manipulate).toHaveBeenCalledWith(ORIGINAL_PHOTO);
    // 手動モックの原寸は 4000x3000。長辺を SHARE_PHOTO_MAX_DIMENSION へ落とす
    expect(manipulate.mock.results[0].value.resize).toHaveBeenCalledWith({
      width: SHARE_PHOTO_MAX_DIMENSION,
    });
    expect(result).toBe('file:///documents/garden-photos/a-compressed.jpg');
  });

  it('writeCardImage は base64 を書き出し、JPEG にしてから共有先へ置く', async () => {
    const destination = await expoHarvestShareAdapter.writeCardImage(
      'BASE64',
      'saien-techo-2026-09-07.jpg',
    );

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/share/card.png',
      'BASE64',
      { encoding: 'base64' },
    );
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/share/card-compressed.jpg',
      to: 'file:///cache/share/saien-techo-2026-09-07.jpg',
    });
    // 中間の PNG は残さない（写真入りだと数 MB になる）
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/share/card.png', {
      idempotent: true,
    });
    expect(destination).toBe('file:///cache/share/saien-techo-2026-09-07.jpg');
  });

  it('shareText は OS のテキスト共有へ渡す', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: null });

    await expoHarvestShareAdapter.shareText('キュウリ 3個 収穫しました');

    expect(share).toHaveBeenCalledWith({ message: 'キュウリ 3個 収穫しました' });
    share.mockRestore();
  });

  it('shareFile は画像として共有シートへ渡す', async () => {
    await expoHarvestShareAdapter.shareFile(CARD_FILE, 'キュウリの収穫を共有');

    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      CARD_FILE,
      expect.objectContaining({ mimeType: 'image/jpeg' }),
    );
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('getHarvestShareCard (real SQLite)', () => {
  let plantingId: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    plantingId = await createPlanting({
      cropName: 'キュウリ',
      variety: '夏すずみ',
      plantedOn: '2026-06-01T00:00:00.000Z',
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  it('作物名・品種・数量・日付と 1 枚目の写真を返す', async () => {
    const harvestId = await createHarvest({
      plantingId,
      harvestedAt: '2026-09-07T02:00:00.000Z',
      quantity: 3,
      unit: 'piece',
      photoUris: ['garden-photos/a.jpg', 'garden-photos/b.jpg'],
    });

    const found = await getHarvestShareCard(harvestId);

    expect(found).toMatchObject({
      harvestId,
      plantingId,
      cropName: 'キュウリ',
      variety: '夏すずみ',
      quantity: 3,
      unit: 'piece',
      photoCount: 2,
    });
    // DB は相対パス。焼き込みには絶対 uri が要るので解決済みで返す
    expect(found?.photoUri).toBe(ORIGINAL_PHOTO);
  });

  it('写真の無い収穫は photoUri が null', async () => {
    const harvestId = await createHarvest({ plantingId, quantity: 1, unit: 'piece' });

    const found = await getHarvestShareCard(harvestId);
    expect(found?.photoUri).toBeNull();
    expect(found?.photoCount).toBe(0);
  });

  /**
   * 場所名は「自宅裏の畑」のように住まいが分かる書き方をされうるし、
   * メモは本人の覚え書き。外へ出す既定に入れない（列そのものを持って来ない）。
   */
  it('場所とメモは持って来ない', async () => {
    const harvestId = await createHarvest({
      plantingId,
      quantity: 1,
      unit: 'piece',
      note: '裏庭の日陰の株。近所の田中さんにおすそ分け',
    });

    const found = await getHarvestShareCard(harvestId);
    expect(JSON.stringify(found)).not.toContain('田中');
    expect(Object.keys(found ?? {}).sort()).toEqual(
      [
        'cropName',
        'harvestId',
        'harvestedAt',
        'photoCount',
        'photoUri',
        'plantingId',
        'quantity',
        'unit',
        'variety',
      ].sort(),
    );
  });

  it('知らない単位は捨てる（集計と同じ扱い）', async () => {
    const harvestId = await createHarvest({ plantingId, quantity: 2, unit: 'piece' });
    mockHandles.expoDb.runSync('UPDATE harvests SET unit = ? WHERE id = ?', ['箱', harvestId]);

    expect((await getHarvestShareCard(harvestId))?.unit).toBeNull();
  });

  it('見つからなければ null', async () => {
    expect(await getHarvestShareCard('missing')).toBeNull();
  });
});

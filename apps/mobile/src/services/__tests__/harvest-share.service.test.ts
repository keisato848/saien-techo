/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）。
 *
 * 見るのは 3 つ。
 *
 * 1. **外へ出す材料に、出してはいけないものが混ざらないこと**（場所・メモ）
 * 2. **写真を出せないときにも「採れた」が伝わること**（ことばへ落ちる）
 * 3. **位置情報を落とす書き出しを通さずに写真が出ていかないこと**
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
}));

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

import {
  buildShareFileName,
  formatCropTitle,
  formatHarvestAmount,
  formatHarvestDate,
  formatHarvestShareText,
  getHarvestShareCard,
  shareHarvestCard,
  type HarvestShareAdapter,
  type HarvestShareCard,
} from '../harvest-share.service';
import { createHarvest } from '../harvest.service';
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
    photoUri: 'file:///documents/garden-photos/a.jpg',
    photoCount: 1,
    ...overrides,
  };
}

interface AdapterCalls {
  prepared: string[];
  files: string[];
  texts: string[];
  textWithFile: [string, string][];
}

function stubAdapter(
  platform: HarvestShareAdapter['platform'],
  overrides: Partial<HarvestShareAdapter> = {},
): { adapter: HarvestShareAdapter; calls: AdapterCalls } {
  const calls: AdapterCalls = { prepared: [], files: [], texts: [], textWithFile: [] };
  const adapter: HarvestShareAdapter = {
    platform,
    isSharingAvailable: () => Promise.resolve(true),
    prepareImage: (uri) => {
      calls.prepared.push(uri);
      return Promise.resolve('file:///cache/share/saien-techo-2026-09-07.jpg');
    },
    shareFile: (uri) => {
      calls.files.push(uri);
      return Promise.resolve();
    },
    shareText: (message) => {
      calls.texts.push(message);
      return Promise.resolve();
    },
    shareTextWithFile: (message, uri) => {
      calls.textWithFile.push([message, uri]);
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

describe('shareHarvestCard', () => {
  it('Android は写真を書き出してから共有シートへ渡す', async () => {
    const { adapter, calls } = stubAdapter('android');

    const outcome = await shareHarvestCard(card(), {}, adapter);

    expect(outcome).toBe('photo');
    // 位置情報を落とす書き出しを必ず通す（原本の uri をそのまま渡さない）
    expect(calls.prepared).toEqual(['file:///documents/garden-photos/a.jpg']);
    expect(calls.files).toEqual(['file:///cache/share/saien-techo-2026-09-07.jpg']);
    expect(calls.texts).toEqual([]);
  });

  it('iOS は写真とことばを 1 回で渡す', async () => {
    const { adapter, calls } = stubAdapter('ios');

    const outcome = await shareHarvestCard(card(), {}, adapter);

    expect(outcome).toBe('photo-with-text');
    expect(calls.textWithFile).toEqual([
      [formatHarvestShareText(card()), 'file:///cache/share/saien-techo-2026-09-07.jpg'],
    ]);
    expect(calls.files).toEqual([]);
  });

  it('写真の無い収穫はことばだけ共有する', async () => {
    const { adapter, calls } = stubAdapter('android');

    const outcome = await shareHarvestCard(card({ photoUri: null }), {}, adapter);

    expect(outcome).toBe('text');
    expect(calls.texts).toEqual([formatHarvestShareText(card({ photoUri: null }))]);
    expect(calls.prepared).toEqual([]);
  });

  it('ことばだけを選んだら写真には触らない', async () => {
    const { adapter, calls } = stubAdapter('ios');

    const outcome = await shareHarvestCard(card(), { textOnly: true }, adapter);

    expect(outcome).toBe('text');
    expect(calls.prepared).toEqual([]);
    expect(calls.textWithFile).toEqual([]);
  });

  it('共有シートが使えない端末ではことばへ落ちる', async () => {
    const { adapter, calls } = stubAdapter('android', {
      isSharingAvailable: () => Promise.resolve(false),
    });

    expect(await shareHarvestCard(card(), {}, adapter)).toBe('text');
    expect(calls.prepared).toEqual([]);
    expect(calls.texts).toHaveLength(1);
  });

  /**
   * ここが安全側の要。書き出しに失敗した写真を「せめて原本を」と渡すと、
   * 位置情報の付いた写真がそのまま外へ出る（photo-storage.service と同じ fail-closed）。
   */
  it('書き出しに失敗したら原本を渡さず、ことばへ落ちる', async () => {
    const { adapter, calls } = stubAdapter('android', {
      prepareImage: () => Promise.reject(new Error('壊れています')),
    });

    expect(await shareHarvestCard(card(), {}, adapter)).toBe('text');
    expect(calls.files).toEqual([]);
    expect(calls.texts).toHaveLength(1);
  });

  it('iOS でも書き出しに失敗したら原本を渡さない', async () => {
    const { adapter, calls } = stubAdapter('ios', {
      prepareImage: () => Promise.reject(new Error('壊れています')),
    });

    expect(await shareHarvestCard(card(), {}, adapter)).toBe('text');
    expect(calls.textWithFile).toEqual([]);
    expect(calls.texts).toHaveLength(1);
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
    // DB は相対パス。共有は絶対 uri でしか渡せないので解決済みで返す
    expect(found?.photoUri).toBe('file:///documents/garden-photos/a.jpg');
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

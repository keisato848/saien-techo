/**
 * 収穫サービスを実 SQLite に対してテストする（R06 / WBS 2.1）。
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

// 実機では documentDirectory が入る。null だと resolvePhotoUri が素通しして
// 「解決されているか」の検証にならない
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }));

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: (paths: string[]) => {
    mockDeletedFiles.push(...paths);
    return Promise.resolve();
  },
}));

import {
  createHarvest,
  deleteHarvest,
  getHarvestAlbum,
  getHarvestCropNames,
  groupByMonth,
  getDefaultUnitForPlanting,
  getHarvest,
  getHarvests,
  getHarvestTotals,
  HARVEST_UNIT_LABEL,
  HARVEST_UNITS,
  updateHarvest,
} from '../harvest.service';
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

function seedCrop(id: string, name: string, defaultUnit: string | null): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO crops (id, name, default_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, defaultUnit, now, now],
  );
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('harvest.service (real SQLite)', () => {
  let plantingId: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    mockDeletedFiles.length = 0;
    seedFamily();
    plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: daysAgoIso(60),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  describe('createHarvest', () => {
    it('写真だけで記録できる（数量は任意 — R06）', async () => {
      const id = await createHarvest({ plantingId, photoUris: ['/h1.jpg'] });
      const harvest = await getHarvest(id);

      expect(harvest?.quantity).toBeNull();
      expect(harvest?.unit).toBeNull();
      expect(harvest?.photoUris).toEqual(['/h1.jpg']);
    });

    it('何も付けずに記録できる', async () => {
      const id = await createHarvest({ plantingId });
      expect(await getHarvest(id)).not.toBeNull();
    });

    it('数量と単位を記録できる', async () => {
      const id = await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      const harvest = await getHarvest(id);

      expect(harvest?.quantity).toBe(5);
      expect(harvest?.unit).toBe('piece');
    });

    it('小数の数量を保てる（1.5kg など）', async () => {
      const id = await createHarvest({ plantingId, quantity: 1.5, unit: 'kg' });
      expect((await getHarvest(id))?.quantity).toBe(1.5);
    });

    it('数量なしで単位だけ指定しても、単位は残さない', async () => {
      // 「個」だけ選んで数を入れずに保存したケース。単位だけ残ると集計で扱えない
      const id = await createHarvest({ plantingId, unit: 'piece' });
      expect((await getHarvest(id))?.unit).toBeNull();
    });

    it('日時は未指定なら「今」になる', async () => {
      const before = Date.now();
      const id = await createHarvest({ plantingId });
      const at = new Date((await getHarvest(id))?.harvestedAt ?? '').getTime();

      expect(at).toBeGreaterThanOrEqual(before - 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('写真は 6 枚まで', async () => {
      await expect(
        createHarvest({ plantingId, photoUris: ['/1', '/2', '/3', '/4', '/5', '/6', '/7'] }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('getHarvests', () => {
    it('新しい順に返す', async () => {
      await createHarvest({ plantingId, harvestedAt: daysAgoIso(5), quantity: 1, unit: 'piece' });
      await createHarvest({ plantingId, harvestedAt: daysAgoIso(1), quantity: 2, unit: 'piece' });
      await createHarvest({ plantingId, harvestedAt: daysAgoIso(9), quantity: 3, unit: 'piece' });

      expect((await getHarvests(plantingId)).map((h) => h.quantity)).toEqual([2, 1, 3]);
    });

    it('他の栽培の収穫は混ざらない', async () => {
      const other = await createPlanting({
        cropName: 'キュウリ',
        plantedOn: daysAgoIso(30),
        plantedAs: 'seedling',
        tags: [],
      });
      await createHarvest({ plantingId });
      await createHarvest({ plantingId: other });

      expect(await getHarvests(plantingId)).toHaveLength(1);
    });

    it('複数の収穫で写真が取り違えられない', async () => {
      const a = await createHarvest({ plantingId, photoUris: ['/a1', '/a2'] });
      const b = await createHarvest({ plantingId, photoUris: ['/b1'] });

      const list = await getHarvests(plantingId);
      expect(list.find((h) => h.id === a)?.photoUris).toEqual(['/a1', '/a2']);
      expect(list.find((h) => h.id === b)?.photoUris).toEqual(['/b1']);
    });
  });

  describe('getHarvestTotals', () => {
    it('同じ単位は足し合わせる', async () => {
      await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      await createHarvest({ plantingId, quantity: 3, unit: 'piece' });

      expect(await getHarvestTotals(plantingId)).toEqual([{ unit: 'piece', quantity: 8 }]);
    });

    it('単位が違えば分けて出す（個と g は足せない）', async () => {
      await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      await createHarvest({ plantingId, quantity: 200, unit: 'g' });

      expect(await getHarvestTotals(plantingId)).toEqual([
        { unit: 'piece', quantity: 5 },
        { unit: 'g', quantity: 200 },
      ]);
    });

    it('数量なしの収穫は合計に入らない', async () => {
      await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      await createHarvest({ plantingId, photoUris: ['/x.jpg'] });

      expect(await getHarvestTotals(plantingId)).toEqual([{ unit: 'piece', quantity: 5 }]);
    });

    it('数量つきが 1 件も無ければ空', async () => {
      await createHarvest({ plantingId, photoUris: ['/x.jpg'] });
      expect(await getHarvestTotals(plantingId)).toEqual([]);
    });

    it('小数を含めて合計できる', async () => {
      await createHarvest({ plantingId, quantity: 1.5, unit: 'kg' });
      await createHarvest({ plantingId, quantity: 0.8, unit: 'kg' });

      const totals = await getHarvestTotals(plantingId);
      expect(totals[0].unit).toBe('kg');
      expect(totals[0].quantity).toBeCloseTo(2.3, 5);
    });
  });

  describe('getDefaultUnitForPlanting', () => {
    it('作物マスターの既定単位を返す', async () => {
      seedCrop('crop-tomato', 'トマト', 'piece');
      const withCrop = await createPlanting({
        cropName: 'トマト',
        cropId: 'crop-tomato',
        plantedOn: daysAgoIso(30),
        plantedAs: 'seedling',
        tags: [],
      });

      expect(await getDefaultUnitForPlanting(withCrop)).toBe('piece');
    });

    it('マスターに無い作物（自由入力）なら null', async () => {
      expect(await getDefaultUnitForPlanting(plantingId)).toBeNull();
    });

    it('マスターの既定単位が未知の値なら null（不正値を UI に流さない）', async () => {
      seedCrop('crop-odd', 'なにか', 'ダース');
      const odd = await createPlanting({
        cropName: 'なにか',
        cropId: 'crop-odd',
        plantedOn: daysAgoIso(10),
        plantedAs: 'seed',
        tags: [],
      });

      expect(await getDefaultUnitForPlanting(odd)).toBeNull();
    });
  });

  describe('updateHarvest', () => {
    it('数量と単位を変えられる', async () => {
      const id = await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      await updateHarvest(id, { quantity: 300, unit: 'g' });

      const harvest = await getHarvest(id);
      expect(harvest?.quantity).toBe(300);
      expect(harvest?.unit).toBe('g');
    });

    it('数量を消すと単位も消える', async () => {
      const id = await createHarvest({ plantingId, quantity: 5, unit: 'piece' });
      await updateHarvest(id, { quantity: null, unit: 'piece' });

      const harvest = await getHarvest(id);
      expect(harvest?.quantity).toBeNull();
      expect(harvest?.unit).toBeNull();
    });

    it('外した写真だけファイルを消す', async () => {
      const id = await createHarvest({ plantingId, photoUris: ['/keep', '/drop'] });
      mockDeletedFiles.length = 0;

      await updateHarvest(id, { photoUris: ['/keep'] });

      expect(mockDeletedFiles).toEqual(['/drop']);
    });
  });

  describe('deleteHarvest', () => {
    it('収穫と写真の行を消し、端末のファイルも消す', async () => {
      const id = await createHarvest({ plantingId, photoUris: ['/a.jpg'] });
      mockDeletedFiles.length = 0;

      await deleteHarvest(id);

      expect(await getHarvest(id)).toBeNull();
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(0);
      expect(mockDeletedFiles).toEqual(['/a.jpg']);
    });

    it('他の収穫の写真は消さない', async () => {
      const target = await createHarvest({ plantingId, photoUris: ['/x.jpg'] });
      await createHarvest({ plantingId, photoUris: ['/y.jpg'] });

      await deleteHarvest(target);
      expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(1);
    });
  });

  it('栽培を削除すると収穫と写真も消える（FK の確認）', async () => {
    await createHarvest({ plantingId, photoUris: ['/a.jpg'] });
    await deletePlanting(plantingId);

    expect(mockHandles.expoDb.getAllSync('SELECT id FROM harvests')).toHaveLength(0);
    expect(mockHandles.expoDb.getAllSync('SELECT id FROM photos')).toHaveLength(0);
  });

  it('すべての単位に表示名がある', () => {
    for (const unit of HARVEST_UNITS) {
      expect(HARVEST_UNIT_LABEL[unit]).toBeTruthy();
    }
  });
});

describeIfSqlite('収穫アルバムの写真パス', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => {
    mockHandles.close();
  });

  it('アルバムのセルにも解決済みの URI を渡す（相対のままだと全部空になる）', async () => {
    const plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: '2026-05-01',
      plantedAs: 'seedling',
      tags: [],
    });
    await createHarvest({
      plantingId,
      harvestedAt: '2026-06-01T00:00:00.000Z',
      photoUris: ['file:///documents/garden-photos/a.jpg'],
    });

    const cells = await getHarvestAlbum();
    const withPhoto = cells.find((cell) => cell.photoUri != null);

    expect(withPhoto?.photoUri).toBeTruthy();
    // file:// が無い相対パスを <Image> に渡すと描画できない
    expect(withPhoto?.photoUri?.startsWith('garden-photos/')).toBe(false);
  });
});

describeIfSqlite('収穫アルバム (R07 / WBS 2.2)', () => {
  let tomato: string;
  let cucumber: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    mockDeletedFiles.length = 0;
    seedFamily();
    tomato = await createPlanting({
      cropName: 'トマト',
      plantedOn: daysAgoIso(90),
      plantedAs: 'seedling',
      tags: [],
    });
    cucumber = await createPlanting({
      cropName: 'キュウリ',
      plantedOn: daysAgoIso(60),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  it('写真 1 枚が 1 マスになる（収穫 1 件ではない）', async () => {
    await createHarvest({ plantingId: tomato, photoUris: ['/a.jpg', '/b.jpg', '/c.jpg'] });

    const cells = await getHarvestAlbum();
    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.photoUri)).toEqual(['/a.jpg', '/b.jpg', '/c.jpg']);
  });

  it('同じ収穫の複数マスでも key が重複しない', async () => {
    await createHarvest({ plantingId: tomato, photoUris: ['/a.jpg', '/b.jpg'] });

    const keys = (await getHarvestAlbum()).map((cell) => cell.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('写真の無い収穫も 1 マスとして出す（記録が消えない）', async () => {
    await createHarvest({ plantingId: tomato, quantity: 5, unit: 'piece' });

    const cells = await getHarvestAlbum();
    expect(cells).toHaveLength(1);
    expect(cells[0].photoUri).toBeNull();
    expect(cells[0].quantity).toBe(5);
  });

  it('新しい順に並ぶ', async () => {
    await createHarvest({ plantingId: tomato, harvestedAt: daysAgoIso(30), photoUris: ['/old'] });
    await createHarvest({ plantingId: tomato, harvestedAt: daysAgoIso(1), photoUris: ['/new'] });

    expect((await getHarvestAlbum()).map((cell) => cell.photoUri)).toEqual(['/new', '/old']);
  });

  it('作物名で絞れる', async () => {
    await createHarvest({ plantingId: tomato, photoUris: ['/t.jpg'] });
    await createHarvest({ plantingId: cucumber, photoUris: ['/c.jpg'] });

    const cells = await getHarvestAlbum({ cropName: 'トマト' });
    expect(cells).toHaveLength(1);
    expect(cells[0].cropName).toBe('トマト');
  });

  it('作物名で絞ると、同じ名前の別の栽培もまとまる（年をまたぐ想定）', async () => {
    const lastYear = await createPlanting({
      cropName: 'トマト',
      plantedOn: daysAgoIso(400),
      plantedAs: 'seedling',
      tags: [],
    });
    await createHarvest({ plantingId: tomato, photoUris: ['/now.jpg'] });
    await createHarvest({
      plantingId: lastYear,
      harvestedAt: daysAgoIso(380),
      photoUris: ['/past.jpg'],
    });

    expect(await getHarvestAlbum({ cropName: 'トマト' })).toHaveLength(2);
  });

  it('栽培で絞れる', async () => {
    await createHarvest({ plantingId: tomato, photoUris: ['/t.jpg'] });
    await createHarvest({ plantingId: cucumber, photoUris: ['/c.jpg'] });

    const cells = await getHarvestAlbum({ plantingId: cucumber });
    expect(cells).toHaveLength(1);
    expect(cells[0].plantingId).toBe(cucumber);
  });

  it('収穫が無ければ空', async () => {
    expect(await getHarvestAlbum()).toEqual([]);
  });

  describe('getHarvestCropNames', () => {
    it('収穫のある作物だけを名前順で返す', async () => {
      await createHarvest({ plantingId: cucumber });
      await createHarvest({ plantingId: tomato });

      expect(await getHarvestCropNames()).toEqual(['キュウリ', 'トマト']);
    });

    it('同じ作物は 1 つに畳む', async () => {
      await createHarvest({ plantingId: tomato });
      await createHarvest({ plantingId: tomato });

      expect(await getHarvestCropNames()).toEqual(['トマト']);
    });

    it('収穫の無い栽培は出さない', async () => {
      await createHarvest({ plantingId: tomato });
      expect(await getHarvestCropNames()).not.toContain('キュウリ');
    });
  });

  describe('groupByMonth', () => {
    function cell(harvestedAt: string, key: string) {
      return {
        key,
        harvestId: key,
        plantingId: 'p',
        cropName: 'トマト',
        harvestedAt,
        quantity: null,
        unit: null,
        photoUri: null,
      };
    }

    it('同じ月をまとめる', () => {
      const months = groupByMonth([
        cell('2026-08-20T03:00:00.000Z', 'a'),
        cell('2026-08-02T03:00:00.000Z', 'b'),
        cell('2026-07-30T03:00:00.000Z', 'c'),
      ]);

      expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-07']);
      expect(months[0].cells).toHaveLength(2);
    });

    it('端末のタイムゾーンで月を決める', () => {
      // 月初 0 時台。toISOString() の日付で束ねると前月に混ざる
      const local = new Date();
      local.setDate(1);
      local.setHours(0, 30, 0, 0);

      const [month] = groupByMonth([cell(local.toISOString(), 'a')]);
      const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`;
      expect(month.month).toBe(expected);
    });

    it('空配列なら空', () => {
      expect(groupByMonth([])).toEqual([]);
    });
  });
});

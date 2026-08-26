/**
 * 作物名 → マスターの照合（実機レビュー 2026-08-26）。
 *
 * 栽培フォームには候補も照合も無く、手入力の栽培は cropId が null のまま残っていた。
 * その状態だと「つぎの作業」「進行帯」「収穫の既定単位」が静かに効かなくなる。
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

import {
  backfillPlantingCropIds,
  CROP_NAME_ALIASES,
  matchCropMaster,
  type CropMasterRow,
} from '../crop-match.service';

/** 実マスターに実在する名前だけで組む（架空の「ミニトマト」を入れない） */
const MASTER: CropMasterRow[] = [
  { id: 'crop-tomato', name: 'トマト', nameReading: 'とまと' },
  { id: 'crop-shiso', name: 'シソ', nameReading: 'しそ' },
  { id: 'crop-edamame', name: 'エダマメ', nameReading: 'えだまめ' },
  { id: 'crop-cabbage', name: 'キャベツ', nameReading: 'きゃべつ' },
  { id: 'crop-ichigo', name: 'イチゴ', nameReading: 'いちご' },
  { id: 'crop-hanegi', name: '葉ネギ', nameReading: 'はねぎ' },
];

describe('matchCropMaster', () => {
  it('完全一致を拾う（手入力でも cropId が付く）', () => {
    expect(matchCropMaster('トマト', MASTER)).toEqual({
      cropId: 'crop-tomato',
      cropNameReading: 'とまと',
    });
  });

  it('別名を拾う（アオジソ → シソ）— 包含では当たらない組み合わせ', () => {
    // 「アオジソ」は「シソ」を部分文字列として含まない（ジ ≠ シ）
    expect('アオジソ'.includes('シソ')).toBe(false);
    expect(matchCropMaster('アオジソ', MASTER).cropId).toBe('crop-shiso');
    expect(matchCropMaster('大葉', MASTER).cropId).toBe('crop-shiso');
    expect(matchCropMaster('枝豆', MASTER).cropId).toBe('crop-edamame');
  });

  it('包含で具体的な名前を寄せる（ミニトマト → トマト）', () => {
    expect(matchCropMaster('ミニトマト', MASTER).cropId).toBe('crop-tomato');
  });

  it('空・未知の作物は null のまま（自由入力を禁じない）', () => {
    expect(matchCropMaster('', MASTER).cropId).toBeNull();
    expect(matchCropMaster('   ', MASTER).cropId).toBeNull();
    expect(matchCropMaster('パクチー', MASTER).cropId).toBeNull();
  });

  it('別名表はすべてマスターに存在する名前を指す（綴り間違いの検出）', () => {
    const names = new Set(MASTER.map((row) => row.name));
    // このテストのマスターに載せている作物ぶんだけ検証する
    for (const [alias, target] of Object.entries(CROP_NAME_ALIASES)) {
      if (!names.has(target)) continue;
      expect(matchCropMaster(alias, MASTER).cropId).toBeTruthy();
    }
  });

  it('【既知の弱点】包含は別作物へ誤爆する — 芽キャベツ / ヘビイチゴ', () => {
    // 調査で見つかった実データの誤爆。**別名表で先に拾えないものは包含に落ちる**。
    // 現状は「暦が近い作物へ寄る」ぶん無害寄りだが、正すなら別名表ではなく
    // マスター側に品目を足すのが筋（芽キャベツは別作物）。
    expect(matchCropMaster('芽キャベツ', MASTER).cropId).toBe('crop-cabbage');
    expect(matchCropMaster('ヘビイチゴ', MASTER).cropId).toBe('crop-ichigo');
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('backfillPlantingCropIds (real SQLite)', () => {
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

  function seedCrop(id: string, name: string): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO crops (id, name, name_reading, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, null, now, now],
    );
  }

  /** サービスを通さず、cropId が null の「既存の行」を直に作る */
  function seedPlantingRow(id: string, cropName: string, cropId: string | null = null): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      `INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-05-01', 'seedling', ?, ?)`,
      [id, FAMILY_ID, cropId, cropName, now, now],
    );
  }

  function cropIdOf(id: string): string | null {
    const rows = mockHandles.expoDb.getAllSync<{ crop_id: string | null }>(
      'SELECT crop_id FROM plantings WHERE id = ?',
      [id],
    );
    return rows[0]?.crop_id ?? null;
  }

  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
    seedCrop('crop-shiso', 'シソ');
    seedCrop('crop-tomato', 'トマト');
  });

  afterEach(() => {
    mockHandles.close();
  });

  it('既存の手入力の栽培を暦へ紐づけ直す（別名も拾う）', async () => {
    seedPlantingRow('p-shiso', 'アオジソ');
    seedPlantingRow('p-tomato', 'トマト');

    expect(await backfillPlantingCropIds()).toBe(2);
    expect(cropIdOf('p-shiso')).toBe('crop-shiso');
    expect(cropIdOf('p-tomato')).toBe('crop-tomato');
  });

  it('既に付いている cropId は動かさない（ガイド経由の紐づけを尊重する）', async () => {
    seedPlantingRow('p-kept', 'アオジソ', 'crop-tomato');

    expect(await backfillPlantingCropIds()).toBe(0);
    expect(cropIdOf('p-kept')).toBe('crop-tomato');
  });

  it('マスターに無い作物は null のまま（自由入力を残す）', async () => {
    seedPlantingRow('p-free', 'パクチー');

    expect(await backfillPlantingCropIds()).toBe(0);
    expect(cropIdOf('p-free')).toBeNull();
  });

  it('冪等 — 2 回走らせても結果が変わらない', async () => {
    seedPlantingRow('p-shiso', '大葉');

    expect(await backfillPlantingCropIds()).toBe(1);
    expect(await backfillPlantingCropIds()).toBe(0);
    expect(cropIdOf('p-shiso')).toBe('crop-shiso');
  });
});

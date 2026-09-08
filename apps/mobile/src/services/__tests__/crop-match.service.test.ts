/**
 * 作物名 → マスターの照合（実機レビュー 2026-08-26 / 4.19 のレビュー 7）。
 *
 * 栽培フォームには候補も照合も無く、手入力の栽培は cropId が null のまま残っていた。
 * その状態だと「つぎの作業」「進行帯」「収穫の既定単位」が静かに効かなくなる。
 *
 * **判定は作り物のマスターではなく実 `CROP_MASTER`（50 品目）に当てる。**
 * 6 行のマスターに当てていたころは、別名 51 件のうち 13 件しか検査されておらず、
 * 「ネギ」が長ネギへ行かないことも、漢字の「大根」が拾えないことも見えなかった。
 */
import { CROP_MASTER } from '../../db/crop-master';
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
  ambiguousCropCandidates,
  backfillPlantingCropIds,
  CROP_NAME_ALIASES,
  matchCropMaster,
  suggestCropNames,
  type CropMasterRow,
} from '../crop-match.service';

/** 端末に投入されるのと同じ 50 品目。名前・読みだけを使う */
const MASTER: CropMasterRow[] = CROP_MASTER.map((crop) => ({
  id: crop.id,
  name: crop.name,
  nameReading: crop.nameReading,
}));

const MASTER_NAMES = new Set(MASTER.map((row) => row.name));

describe('matchCropMaster', () => {
  it('完全一致を拾う（手入力でも cropId が付く）', () => {
    expect(matchCropMaster('トマト', MASTER)).toEqual({
      cropId: 'crop-tomato',
      cropNameReading: 'とまと',
    });
  });

  it('読みの完全一致を拾う（かなで打っても当たる）', () => {
    expect(matchCropMaster('きゅうり', MASTER).cropId).toBe('crop-cucumber');
    expect(matchCropMaster('ほうれんそう', MASTER).cropId).toBe('crop-hourensou');
  });

  it('読みは完全一致だけ — 「いも」を「さといも」に寄せない', () => {
    expect(matchCropMaster('いも', MASTER).cropId).toBeNull();
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

  // ─── 漢字の別名（レビュー 7b）───────────────────────────────────────
  // 漢字は読みでは拾えない。ここが落ちると「大根」「胡瓜」と書く人の栽培だけが
  // cropId 無しで残り、進行帯も「つぎの作業」も出ない
  it.each([
    ['大根', 'crop-daikon'],
    ['人参', 'crop-ninjin'],
    ['玉ねぎ', 'crop-tamanegi'],
    ['白菜', 'crop-hakusai'],
    ['春菊', 'crop-shungiku'],
    ['水菜', 'crop-mizuna'],
    ['小松菜', 'crop-komatsuna'],
    ['法蓮草', 'crop-hourensou'],
    ['馬鈴薯', 'crop-jagaimo'],
    ['薩摩芋', 'crop-satsumaimo'],
    ['大蒜', 'crop-ninniku'],
    ['茄子', 'crop-nasu'],
    ['胡瓜', 'crop-cucumber'],
    ['南瓜', 'crop-kabocha'],
    ['蕪', 'crop-kabu'],
    ['苺', 'crop-ichigo'],
  ])('漢字の %s を寄せる', (input, cropId) => {
    expect(matchCropMaster(input, MASTER).cropId).toBe(cropId);
  });

  // ─── 代表 10 件（手入力でいちばん起きる形）───────────────────────────
  it.each([
    ['トマト', 'crop-tomato'],
    ['ミニトマト', 'crop-tomato'],
    ['きゅうり', 'crop-cucumber'],
    ['じゃがいも', 'crop-jagaimo'],
    ['大根', 'crop-daikon'],
    ['青梗菜', 'crop-chingensai'],
    ['白ネギ', 'crop-naganegi'],
    ['スナックエンドウ', 'crop-snap-endou'],
    ['二十日大根', 'crop-radisshu'],
    ['アオジソ', 'crop-shiso'],
  ])('代表例: %s', (input, cropId) => {
    expect(matchCropMaster(input, MASTER).cropId).toBe(cropId);
  });

  it('別名表はすべて実在するマスター名を指し、実マスターで解決できる', () => {
    // **`continue` で飛ばさない。** 飛ばしていたころは 51 件中 13 件しか見ていなかった
    for (const [alias, target] of Object.entries(CROP_NAME_ALIASES)) {
      expect(MASTER_NAMES.has(target)).toBe(true);
      expect(matchCropMaster(alias, MASTER)).toEqual(
        expect.objectContaining({ cropId: expect.any(String) }),
      );
    }
  });

  it('別名は狙ったマスターへ行く（別作物に化けない）', () => {
    for (const [alias, target] of Object.entries(CROP_NAME_ALIASES)) {
      const expected = MASTER.find((row) => row.name === target);
      expect(matchCropMaster(alias, MASTER).cropId).toBe(expected?.id);
    }
  });

  // ─── どちらとも取れる名前（レビュー 7c）───────────────────────────────
  describe('迷う名前は寄せずに選ばせる', () => {
    it('「ネギ」は葉ネギに固定しない（長ネギは 150 日・11〜2 月で暦が別物）', () => {
      expect(matchCropMaster('ネギ', MASTER).cropId).toBeNull();
      expect(ambiguousCropCandidates('ネギ')).toEqual(['長ネギ', '葉ネギ']);
      expect(ambiguousCropCandidates('ねぎ')).toEqual(['長ネギ', '葉ネギ']);
    });

    it('「エンドウ」は長さ順でスナップエンドウへ落とさない', () => {
      expect(matchCropMaster('エンドウ', MASTER).cropId).toBeNull();
      expect(ambiguousCropCandidates('エンドウ')).toEqual(['サヤエンドウ', 'スナップエンドウ']);
    });

    it('迷わない名前では候補を出さない', () => {
      expect(ambiguousCropCandidates('トマト')).toEqual([]);
      expect(ambiguousCropCandidates('')).toEqual([]);
    });
  });

  // ─── 包含の誤爆（レビュー 7d）─────────────────────────────────────────
  it('別作物なのに包含で寄っていたものを止める', () => {
    expect(matchCropMaster('芽キャベツ', MASTER).cropId).toBeNull();
    expect(matchCropMaster('ロマネスコ', MASTER).cropId).toBeNull();
    expect(matchCropMaster('そうめんカボチャ', MASTER).cropId).toBeNull();
  });

  it('1〜2 文字では寄せない（打鍵ごとの連作チェックが誤警告していた）', () => {
    // #186 の連作チェックは打鍵のたびに引く。「ナ」でスナップエンドウに寄ると
    // 1 文字目から「南の畝では去年…」が出る
    expect(matchCropMaster('菜', MASTER).cropId).toBeNull();
    expect(matchCropMaster('ナ', MASTER).cropId).toBeNull();
    expect(matchCropMaster('サ', MASTER).cropId).toBeNull();
  });

  it('逆向きの包含は 3 文字以上かつ 1 件に絞れるときだけ', () => {
    expect(matchCropMaster('ホウレン', MASTER).cropId).toBe('crop-hourensou');
    // サヤエンドウ・スナップエンドウの 2 件に当たるので寄せない
    expect(matchCropMaster('ンドウ', MASTER).cropId).toBeNull();
  });

  /**
   * **いまも残っている誤爆。** 直したらこのテストが落ちるので、そのとき消す。
   * ヘビイチゴは食用に育てるものではなく、マスターに足す品目でもない。
   */
  it.each([['ヘビイチゴ', 'crop-ichigo']])(
    '【既知の弱点】%s は包含で寄ってしまう',
    (input, cropId) => {
      expect(matchCropMaster(input, MASTER).cropId).toBe(cropId);
    },
  );
});

// ─── 栽培フォームの候補（レビュー 41）─────────────────────────────────────
describe('suggestCropNames', () => {
  it('2 文字未満では出さない（候補が全品目になる）', () => {
    expect(suggestCropNames('ト', MASTER)).toEqual([]);
    expect(suggestCropNames('', MASTER)).toEqual([]);
  });

  it('名前の前方一致を出す', () => {
    expect(suggestCropNames('トマ', MASTER).map((row) => row.name)).toEqual(['トマト']);
  });

  it('読みの前方一致を出す（かな入力の途中でも当たる）', () => {
    expect(suggestCropNames('とま', MASTER).map((row) => row.name)).toContain('トマト');
    expect(suggestCropNames('だいこ', MASTER).map((row) => row.name)).toContain('ダイコン');
  });

  it('別名の前方一致を出す（店頭の呼び方から正式名へ）', () => {
    expect(suggestCropNames('ミニ', MASTER).map((row) => row.name)).toEqual(['トマト']);
    expect(suggestCropNames('絹さ', MASTER).map((row) => row.name)).toEqual(['サヤエンドウ']);
  });

  it('読みも返す（押したら読みまで埋められる）', () => {
    expect(suggestCropNames('トマ', MASTER)[0]).toEqual({
      id: 'crop-tomato',
      name: 'トマト',
      nameReading: 'とまと',
    });
  });

  it('打ち切った名前そのものは候補にしない', () => {
    expect(suggestCropNames('トマト', MASTER).map((row) => row.name)).not.toContain('トマト');
  });

  it('当たらなければ空（自由入力を禁じない）', () => {
    expect(suggestCropNames('パクチ', MASTER)).toEqual([]);
  });

  it('5 件で打ち切る', () => {
    const many: CropMasterRow[] = Array.from({ length: 8 }, (_, index) => ({
      id: `crop-${index}`,
      name: `ナスビ${index}`,
      nameReading: `なすび${index}`,
    }));
    expect(suggestCropNames('ナス', many)).toHaveLength(5);
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

  function seedCrop(id: string, name: string, nameReading: string | null = null): void {
    const now = new Date().toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO crops (id, name, name_reading, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, nameReading, now, now],
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
    seedCrop('crop-shiso', 'シソ', 'しそ');
    seedCrop('crop-tomato', 'トマト', 'とまと');
    seedCrop('crop-cucumber', 'キュウリ', 'きゅうり');
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

  // 照合を強くしたぶんは、保存し直さなくても既存の栽培に遡って効く（レビュー 7f）
  it('漢字・かなで書いた既存の栽培も遡って紐づく', async () => {
    seedPlantingRow('p-kanji', '胡瓜');
    seedPlantingRow('p-kana', 'きゅうり');

    expect(await backfillPlantingCropIds()).toBe(2);
    expect(cropIdOf('p-kanji')).toBe('crop-cucumber');
    expect(cropIdOf('p-kana')).toBe('crop-cucumber');
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

/**
 * seedDatabase() を実 SQLite に流して、サンプルデータが本当に入るか検証する。
 *
 * 実機では daidoko 由来の「利用者のデータを消さない」ガード
 * （shouldInstallSampleData）が働くため、一度でも手で作ったデータがあると
 * 以降シードは走らない。つまり実機確認だけではシードの不備に気づけない。
 * FK 違反・NOT NULL 漏れ・投入順の誤りはここで捕まえる。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;

jest.mock('../client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

import { seedDatabase } from '../migrate';
import { seedPlantings, seedPlantingTags } from '../seed';
import { IDENTIFY_PER_REWARD } from '../../services/identify-credit.service';

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('seedDatabase against real SQLite', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    await seedDatabase(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  function rows<T = Record<string, unknown>>(sql: string): T[] {
    return mockHandles.expoDb.getAllSync<T>(sql);
  }

  it('栽培が投入される', () => {
    expect(rows('SELECT id FROM plantings')).toHaveLength(seedPlantings.length);
  });

  it('作物マスターとガイド・栽培暦が投入される', () => {
    expect(rows('SELECT id FROM crops').length).toBeGreaterThan(0);
    expect(rows('SELECT crop_id FROM crop_guides').length).toBeGreaterThan(0);
    expect(rows('SELECT id FROM crop_calendars').length).toBeGreaterThan(0);
  });

  it('場所・作業ログ・収穫・資材が投入される', () => {
    expect(rows('SELECT id FROM places').length).toBeGreaterThan(0);
    expect(rows('SELECT id FROM care_logs').length).toBeGreaterThan(0);
    expect(rows('SELECT id FROM harvests').length).toBeGreaterThan(0);
    expect(rows('SELECT id FROM materials').length).toBeGreaterThan(0);
  });

  it('栽培タグが張られる', () => {
    expect(rows('SELECT planting_id FROM planting_tags')).toHaveLength(seedPlantingTags.length);
  });

  it('栽培タグは料理用タグとは別のものが使われる', () => {
    const names = rows<{ name: string }>(
      `SELECT DISTINCT t.name AS name
         FROM planting_tags pt JOIN tags t ON t.id = pt.tag_id`,
    ).map((row) => row.name);

    expect(names).toContain('夏野菜');
    // だいどこの料理タグが栽培に紐づいていないこと
    expect(names).not.toContain('揚げ物');
    expect(names).not.toContain('汁物');
  });

  it('作物マスターに無い栽培（crop_id が NULL）も含まれる', () => {
    const free = rows<{ crop_name: string }>(
      'SELECT crop_name FROM plantings WHERE crop_id IS NULL',
    );
    expect(free.length).toBeGreaterThan(0);
  });

  it('終了した栽培が 1 件以上ある（アーカイブ表示の確認用）', () => {
    expect(rows('SELECT id FROM plantings WHERE ended_at IS NOT NULL').length).toBeGreaterThan(0);
  });

  it('planting_fts が作物名の読みで引ける', () => {
    const hits = rows<{ planting_id: string }>(
      "SELECT planting_id FROM planting_fts WHERE planting_fts MATCH 'とまと*'",
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it('外部キーが全て解決している', () => {
    // PRAGMA foreign_key_check は違反行を返す。空なら健全
    expect(rows('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('「写真から登録」の残高が入り、IDENTIFY_PER_REWARD と一致する', () => {
    // seed.ts は循環 import を避けて数値で持っている。**ずれたらここで落とす。**
    // 残高が 0 だと掲載スクショが「動画を 1 本見ると…」になり、
    // 広告を見ないと使えないアプリに見える（#152）
    const got = rows<{ value: string }>(
      "SELECT value FROM app_meta WHERE key = 'planting_identify_credits'",
    );
    expect(got).toHaveLength(1);
    expect(Number(got[0].value)).toBe(IDENTIFY_PER_REWARD);
  });

  it('2 回呼んでも重複しない', async () => {
    await seedDatabase(mockHandles.db);
    expect(rows('SELECT id FROM plantings')).toHaveLength(seedPlantings.length);
    expect(rows('SELECT planting_id FROM planting_tags')).toHaveLength(seedPlantingTags.length);
  });
});

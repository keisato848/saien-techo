/**
 * マイグレーション SQL を実 SQLite で実行して検証する。
 *
 * migrate.test.ts は execSync をモックして呼び出し回数とバージョンだけを見るため、
 * SQL が構文エラーでも通ってしまう。ここでは node:sqlite に実際に流し、
 * テーブルと FTS が作られることを確かめる。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runMigrations } from '../migrate';

// node:sqlite は Node 22.5+ の実験的 API。CI（Node 20/24）と開発機で
// 利用可否が変わりうるため、無い環境ではスキップする。
let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] };
}

const SAIEN_TABLES = [
  'crops',
  'crop_calendars',
  'crop_guides',
  'places',
  'plantings',
  'planting_tags',
  'care_logs',
  'harvests',
  'photos',
  'reminders',
  'materials',
];

function extractCreateTablesSql(): string {
  const source = readFileSync(join(__dirname, '..', 'migrate.ts'), 'utf8');
  const matched = /const CREATE_TABLES_SQL = `([\s\S]*?)\n`;/.exec(source);
  if (!matched) throw new Error('migrate.ts から CREATE_TABLES_SQL を抽出できませんでした');
  return matched[1];
}

const describeIfSqlite = DatabaseSync ? describe : describe.skip;

describeIfSqlite('migration SQL against real SQLite', () => {
  function freshDb(): SqliteDb {
    // describeIfSqlite で DatabaseSync が null のときはスキップ済み
    if (!DatabaseSync) throw new Error('node:sqlite が利用できません');
    const db = new DatabaseSync(':memory:');
    db.exec(extractCreateTablesSql());
    return db;
  }

  it('executes without a syntax error and creates every さいえん手帳 table', () => {
    const db = freshDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name as string);

    for (const table of SAIEN_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('no longer creates the だいどこ tables (WBS 2.9e で DROP 済み)', () => {
    const db = freshDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name as string);

    for (const table of [
      'recipes',
      'recipe_revisions',
      'ingredients',
      'steps',
      'sources',
      'recipe_tags',
      'cooking_logs',
      'cooking_photos',
      'memos',
      'ingredient_nutrition',
      'shopping_items',
      'pantry_items',
      'jan_catalog',
      'name_aliases',
    ]) {
      expect(tables).not.toContain(table);
    }
    // tags は栽培のタグ付けに流用するため、だいどこ由来だが残る
    expect(tables).toContain('tags');
  });

  it('既存端末の DROP（取る）: pre-2.9e に残っただいどこテーブルを消し、栽培側は残す', () => {
    const db = freshDb();
    // WBS 2.9e より前からアップグレードした端末を模す。
    // 今の CREATE_TABLES_SQL はこの 2 テーブルをもう作らないので、手で残しておく
    db.exec(`
      CREATE TABLE recipes (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE cooking_logs (id TEXT PRIMARY KEY, recipe_id TEXT REFERENCES recipes(id));
    `);
    db.exec("INSERT INTO recipes (id, title) VALUES ('r1', '肉じゃが')");
    db.exec("INSERT INTO cooking_logs (id, recipe_id) VALUES ('c1', 'r1')");

    runMigrations({ execSync: (sql: string) => db.exec(sql) });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name as string);

    expect(tables).not.toContain('recipes');
    expect(tables).not.toContain('cooking_logs');
    for (const table of [...SAIEN_TABLES, 'tags', 'users', 'families', 'sync_meta', 'app_meta']) {
      expect(tables).toContain(table);
    }
  });

  it('supports Japanese prefix search on planting_fts', () => {
    const db = freshDb();
    db.exec(
      'INSERT INTO planting_fts (planting_id, crop_name, crop_name_reading, variety, tag_names)' +
        " VALUES ('p1','とまと','とまと','あいこ','夏')",
    );

    const hit = db
      .prepare('SELECT planting_id FROM planting_fts WHERE planting_fts MATCH ?')
      .all('とま*');
    expect(hit).toHaveLength(1);
    expect(hit[0].planting_id).toBe('p1');

    const miss = db
      .prepare('SELECT planting_id FROM planting_fts WHERE planting_fts MATCH ?')
      .all('きゅう*');
    expect(miss).toHaveLength(0);
  });

  it('allows a planting without a crop master reference (自由入力)', () => {
    const db = freshDb();
    db.exec(
      'INSERT INTO users (id, display_name, created_at, updated_at)' +
        " VALUES ('u1','tester','2026-01-01','2026-01-01')",
    );
    db.exec(
      'INSERT INTO families (id, name, invite_code, owner_id, created_at, updated_at)' +
        " VALUES ('f1','f','CODE','u1','2026-01-01','2026-01-01')",
    );
    db.exec(
      'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, created_at, updated_at)' +
        " VALUES ('pl1','f1',NULL,'アオジソ','2026-01-01','seed','2026-01-01','2026-01-01')",
    );

    const rows = db.prepare('SELECT crop_id, crop_name FROM plantings').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].crop_id).toBeNull();
    expect(rows[0].crop_name).toBe('アオジソ');
  });
});

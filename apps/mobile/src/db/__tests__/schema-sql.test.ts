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

/**
 * v13: 写真パスの相対化。
 *
 * 実 SQLite で `runMigrations` を通し、既存の絶対パスが相対へ書き換わることと、
 * 毎起動走らせても値が変わらない（冪等）ことを確かめる。
 * ここが壊れると **iOS でバックアップ復元後に全写真が表示できなくなる**。
 */
describeIfSqlite('v13: 写真パスの相対化', () => {
  const DOC = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents/';

  function migratedDb(seed: (db: SqliteDb) => void): SqliteDb {
    if (!DatabaseSync) throw new Error('node:sqlite が利用できません');
    const db = new DatabaseSync(':memory:');
    db.exec(extractCreateTablesSql());
    seed(db);
    runMigrations({ execSync: (sql: string) => db.exec(sql) });
    return db;
  }

  function photoPaths(db: SqliteDb): string[] {
    return db
      .prepare('SELECT local_path FROM photos ORDER BY id')
      .all()
      .map((row) => row.local_path as string);
  }

  function seedPhoto(db: SqliteDb, id: string, path: string): void {
    db.exec(
      `INSERT INTO photos (id, owner_type, owner_id, local_path, sort_order, created_at)
       VALUES ('${id}', 'care_log', 'log-1', '${path}', 1, '2026-05-01T00:00:00.000Z')`,
    );
  }

  it('絶対パスを相対へ書き換える', () => {
    const db = migratedDb((seedDb) => {
      seedPhoto(seedDb, 'p1', `${DOC}garden-photos/a.jpg`);
      seedPhoto(seedDb, 'p2', '/data/user/0/com.saientecho.app/files/recipe-photos/b.jpg');
    });

    expect(photoPaths(db)).toEqual(['garden-photos/a.jpg', 'recipe-photos/b.jpg']);
  });

  it('既に相対のものは触らない（冪等）', () => {
    const db = migratedDb((seedDb) => {
      seedPhoto(seedDb, 'p1', `${DOC}garden-photos/a.jpg`);
      seedPhoto(seedDb, 'p2', 'garden-photos/already.jpg');
    });

    const afterFirst = photoPaths(db);
    runMigrations({ execSync: (sql: string) => db.exec(sql) });

    expect(afterFirst).toEqual(['garden-photos/a.jpg', 'garden-photos/already.jpg']);
    expect(photoPaths(db)).toEqual(afterFirst);
  });

  it('栽培のカバー写真も相対化し、NULL は NULL のまま', () => {
    const db = migratedDb((seedDb) => {
      // plantings.family_id は families への FK。先に親を作る
      seedDb.exec(
        `INSERT INTO users (id, display_name, created_at, updated_at)
         VALUES ('u-1', 'テスト', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`,
      );
      seedDb.exec(
        `INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at)
         VALUES ('f-1', 'テスト農園', 'u-1', 'TEST01', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`,
      );
      seedDb.exec(
        `INSERT INTO plantings (id, family_id, crop_name, planted_on, planted_as, cover_photo_path, created_at, updated_at)
         VALUES ('pl-1', 'f-1', 'トマト', '2026-05-01', 'seedling', '${DOC}recipe-photos/cover.jpg', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`,
      );
      seedDb.exec(
        `INSERT INTO plantings (id, family_id, crop_name, planted_on, planted_as, cover_photo_path, created_at, updated_at)
         VALUES ('pl-2', 'f-1', 'ナス', '2026-05-01', 'seedling', NULL, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')`,
      );
    });

    const rows = db
      .prepare('SELECT id, cover_photo_path FROM plantings ORDER BY id')
      .all()
      .map((row) => row.cover_photo_path);

    expect(rows).toEqual(['recipe-photos/cover.jpg', null]);
  });

  it('知らない場所を指すパスは切り詰めない（復元不能を避ける）', () => {
    const db = migratedDb((seedDb) => {
      seedPhoto(seedDb, 'p1', 'file:///tmp/ImagePicker/unknown.jpg');
    });

    expect(photoPaths(db)).toEqual(['file:///tmp/ImagePicker/unknown.jpg']);
  });
});

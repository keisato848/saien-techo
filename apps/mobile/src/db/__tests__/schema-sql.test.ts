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

/**
 * 追加列（ALTER TABLE … ADD COLUMN）のドリフト検査（4.19 レビュー 26）。
 *
 * SQLite に ADD COLUMN IF NOT EXISTS が無いので、runMigrations は再実行時の
 * duplicate column を握り潰している。以前は**全例外**を握り潰していたため、
 * 列名を書き間違えると静かに追加されず、`syncCropMaster` の insert が
 * `no such column` を投げて**起動不能の「DB Error」全画面**に届きうる。
 *
 * ここでは v13 相当（追加列を落とした）端末を作って `runMigrations` を流し、
 * `CREATE_TABLES_SQL` だけで作った DB と**テーブルごとの列名集合を完全一致**で比べる。
 * 綴り誤りと「CREATE_TABLES_SQL にだけ足す」逆向きのドリフトの両方を、
 * 列が増えても書き足さずに捕まえられる。
 */
describeIfSqlite('追加列のドリフト（ALTER TABLE ADD COLUMN）', () => {
  function fresh(): SqliteDb {
    if (!DatabaseSync) throw new Error('node:sqlite が利用できません');
    const db = new DatabaseSync(':memory:');
    db.exec(extractCreateTablesSql());
    return db;
  }

  function tableNames(db: SqliteDb): string[] {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((row) => row.name as string)
      .filter((name) => !name.startsWith('sqlite_'));
  }

  function columnsOf(db: SqliteDb, table: string): string[] {
    return db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name as string)
      .sort();
  }

  /** runMigrations が実際に流す ADD COLUMN を、文そのものから拾う */
  function addedColumns(): { table: string; column: string }[] {
    const db = fresh();
    const added: { table: string; column: string }[] = [];
    runMigrations({
      execSync: (statement: string) => {
        const matched = /^ALTER TABLE (\w+) ADD COLUMN (\w+)\b/.exec(statement);
        if (matched) added.push({ table: matched[1], column: matched[2] });
        // 新規インストールなので ALTER は duplicate column で失敗する（想定内）
        db.exec(statement);
      },
    });
    return added;
  }

  it('ADD COLUMN の列名は CREATE_TABLES_SQL に実在する（綴り誤りを静かに通さない）', () => {
    const pristine = fresh();
    for (const { table, column } of addedColumns()) {
      expect({ table, column, ok: columnsOf(pristine, table).includes(column) }).toEqual({
        table,
        column,
        ok: true,
      });
    }
  });

  it('追加列を落とした端末に流すと、その列が戻る', () => {
    const pristine = fresh();
    const upgraded = fresh();

    // 追加列を落として「その列がまだ無かった頃の端末」を作る
    for (const { table, column } of addedColumns()) {
      upgraded.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    runMigrations({ execSync: (sql: string) => upgraded.exec(sql) });

    expect(tableNames(upgraded)).toEqual(tableNames(pristine));
    for (const table of tableNames(pristine)) {
      expect({ table, columns: columnsOf(upgraded, table) }).toEqual({
        table,
        columns: columnsOf(pristine, table),
      });
    }
  });

  /**
   * **本物の v13 端末**（4.19 以前に配布した CREATE 文。__fixtures__/schema-v13.sql は
   * 059b92a^ から抜いた歴史のスナップショットで、これ以上更新しない）から
   * runMigrations を流し、新規インストールと列名集合が一致することを見る。
   *
   * 上の「落として戻す」テストは ADD_COLUMN_MIGRATIONS を正としてしまうので、
   * **CREATE_TABLES_SQL にだけ列を足した**逆向きのドリフト
   * （新規インストールでは動くが、更新した端末にだけ列が無い）を捕まえられない。
   * 列が増えてもこのテストは書き足さなくてよい — 足す先は ADD_COLUMN_MIGRATIONS だけ。
   */
  it('v13 の端末に流すと、列名集合が新規インストールと一致する', () => {
    if (!DatabaseSync) throw new Error('node:sqlite が利用できません');
    const pristine = fresh();
    const upgraded = new DatabaseSync(':memory:');
    upgraded.exec(readFileSync(join(__dirname, '__fixtures__', 'schema-v13.sql'), 'utf8'));

    runMigrations({ execSync: (sql: string) => upgraded.exec(sql) });

    for (const table of tableNames(pristine)) {
      expect({ table, columns: columnsOf(upgraded, table) }).toEqual({
        table,
        columns: columnsOf(pristine, table),
      });
    }
  });

  it('duplicate column 以外の失敗は握り潰さない（起動不能の DB Error を防ぐ）', () => {
    expect(() =>
      runMigrations({
        execSync: (statement: string) => {
          if (statement.startsWith('ALTER TABLE')) {
            // 列名を書き間違えた先にあるのはこれ（追加先のテーブルが無い等）
            throw new Error('no such table: crop_guides');
          }
        },
      }),
    ).toThrow('no such table: crop_guides');
  });
});

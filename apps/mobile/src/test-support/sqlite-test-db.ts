/**
 * テスト用の実 SQLite。
 *
 * だいどこは web 用のモック実装（src/db/mock.ts）をサービスのテスト経路にも
 * 使っていたが、モックの分岐と実 SQL が別物なので「テストは通るが端末で落ちる」
 * が起きうる。実際に WBS 1.3 では families.owner_id の NOT NULL を
 * 実 SQL テストだけが捕まえた。
 *
 * ここでは drizzle の sqlite-proxy ドライバを node:sqlite に噛ませ、
 * **本番と同じクエリビルダから本物の SQL を発行**する。expo-sqlite の
 * getAllSync/runSync/execSync 互換のハンドルも返すので、FTS のような
 * 生 SQL 経路もそのまま検証できる。
 *
 * node:sqlite は Node 22.5+ の実験的 API。無い環境では null を返し、
 * 呼び出し側が describe.skip する。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

interface RawStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): unknown;
  columns(): { name: string }[];
}

interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

let DatabaseSync: (new (path: string) => RawDb) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

export const isSqliteAvailable = DatabaseSync !== null;

/** migrate.ts の CREATE 文をそのまま読む。テスト側で写経すると本番とずれる */
function migrationSql(constName: string): string {
  const source = readFileSync(join(__dirname, '..', 'db', 'migrate.ts'), 'utf8');
  const matched = new RegExp(`const ${constName} = \`([\\s\\S]*?)\\n\`;`).exec(source);
  if (!matched) throw new Error(`migrate.ts から ${constName} を抽出できませんでした`);
  return matched[1];
}

export interface TestDbHandles {
  /** サービス層が getDb() で受け取るのと同じ形の drizzle インスタンス */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** expo-sqlite 互換ハンドル。fts.service の生 SQL 経路で使う */
  expoDb: {
    execSync(sql: string): void;
    runSync(sql: string, params?: unknown[]): void;
    getAllSync<T>(sql: string, params?: unknown[]): T[];
  };
  close(): void;
}

/**
 * 空の DB を作り、本番のマイグレーション SQL を流して返す。
 * `PRAGMA foreign_keys = ON` は client.ts の初期化と揃えている
 * （FK 違反をテストで踏めないと、削除の順序ミスが端末まで届く）。
 */
export function createTestDb(): TestDbHandles {
  if (!DatabaseSync) throw new Error('node:sqlite が利用できません');

  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  // CREATE_TABLES_SQL は FTS5 の仮想テーブルまで含んでいる
  raw.exec(migrationSql('CREATE_TABLES_SQL'));

  const db = drizzle(async (sqlText: string, params: unknown[], method: string) => {
    const stmt = raw.prepare(sqlText);
    if (method === 'run') {
      stmt.run(...params);
      return { rows: [] };
    }
    // sqlite-proxy は行を「値の配列」で要求する。node:sqlite はオブジェクトを
    // 返すので、columns() の順に並べ直す
    const columns = stmt.columns().map((column) => column.name);
    const rows = stmt.all(...params).map((row) => columns.map((name) => row[name] ?? null));
    return { rows: method === 'get' ? (rows[0] ?? []) : rows };
  });

  return {
    db,
    expoDb: {
      execSync: (sql) => raw.exec(sql),
      runSync: (sql, params = []) => {
        raw.prepare(sql).run(...params);
      },
      getAllSync: <T>(sql: string, params: unknown[] = []) =>
        raw.prepare(sql).all(...params) as T[],
    },
    close: () => raw.close(),
  };
}

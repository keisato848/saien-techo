/**
 * Database client initialization for expo-sqlite + Drizzle ORM
 * Lazy initialization to avoid crashes on web (expo-sqlite is native-only)
 */
import { Platform } from 'react-native';

import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type * as schema from './schema';

let _db: ExpoSQLiteDatabase<typeof schema> | null = null;
let _expoDb: SQLiteDatabase | null = null;

/** Whether the platform supports expo-sqlite */
export const isNativePlatform = Platform.OS === 'ios' || Platform.OS === 'android';

/** Get the Drizzle ORM database instance (native only) */
export function getDb(): ExpoSQLiteDatabase<typeof schema> {
  if (!_db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _db;
}

/** Get the raw expo-sqlite database instance (native only) */
export function getExpoDb() {
  if (!_expoDb) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _expoDb;
}

/** Initialize the database (call once at app startup, native only) */
export async function initDatabase(): Promise<void> {
  if (_db) return;

  if (!isNativePlatform) {
    // Web: skip SQLite initialization
    return;
  }

  const { drizzle } = await import('drizzle-orm/expo-sqlite');
  const { openDatabaseSync } = await import('expo-sqlite');
  const schemaModule = await import('./schema');

  // だいどこ由来のファイル名から改名した。さいえん手帳は未リリースなので
  // 移行処理は不要（開発端末の古い DB は再インストールで作り直す）。
  const expoDb = openDatabaseSync('saien-techo.db');

  // Set recommended pragmas
  expoDb.execSync('PRAGMA journal_mode = WAL');
  expoDb.execSync('PRAGMA foreign_keys = ON');
  expoDb.execSync('PRAGMA cache_size = -8000');
  expoDb.execSync('PRAGMA temp_store = MEMORY');

  _db = drizzle(expoDb, { schema: schemaModule });
  _expoDb = expoDb;
}

/**
 * バックアップ・復元 — R13 / WBS 2.8
 *
 * だいどこから移植。**対象テーブルはさいえん手帳のものへ入れ替えてある**
 * （移植直後はレシピと調理記録しか入っておらず、バックアップを取っても
 * 栽培・作業ログ・収穫・写真が 1 件も残らなかった）。
 *
 * だいどこ由来のテーブル（recipes・cooking_logs ほか）も当面は含める。
 * 画面はタブから外しただけで消してはいないので、落とすと復元で消えてしまう。
 * 削除は WBS 2.x の派生先が確定してから。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { getDb, getExpoDb, isNativePlatform } from '../db/client';
import { rebuildFts, rebuildPlantingFts } from '../db/migrate';

const BACKUP_FORMAT = 'saien.local-backup';
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_DIRECTORY_NAME = 'backups';
const MIGRATION_BACKUP_FORMAT = 'saien.migration-backup';
const MIGRATION_BACKUP_SCHEMA_VERSION = 1;
const MIGRATION_MANIFEST_FILE_NAME = 'manifest.json';
const MIGRATION_PHOTO_DIRECTORY_NAME = 'backup-photos';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type SqlValue = string | number | null;
type BackupRow = Record<string, SqlValue>;

interface BackupTableDefinition {
  name: BackupTableName;
  columns: readonly string[];
}

const BACKUP_TABLES = [
  {
    name: 'users',
    columns: ['id', 'display_name', 'avatar_url', 'created_at', 'updated_at'],
  },
  {
    name: 'families',
    columns: ['id', 'name', 'invite_code', 'owner_id', 'created_at', 'updated_at'],
  },
  {
    name: 'family_members',
    columns: ['id', 'family_id', 'user_id', 'role', 'joined_at'],
  },
  {
    name: 'sources',
    columns: [
      'id',
      'type',
      'url',
      'ocr_raw_text',
      'site_name',
      'page_title',
      'thumbnail_url',
      'captured_at',
      'created_at',
    ],
  },
  {
    name: 'recipes',
    columns: [
      'id',
      'family_id',
      'title',
      'title_reading',
      'current_rev_id',
      'status',
      'created_by',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'recipe_revisions',
    columns: [
      'id',
      'recipe_id',
      'revision_number',
      'is_major',
      'servings',
      'cook_time_min',
      'prep_time_min',
      'description',
      'author_note',
      'source_id',
      'created_by',
      'created_at',
    ],
  },
  {
    name: 'ingredients',
    columns: ['id', 'revision_id', 'sort_order', 'group_label', 'name', 'amount', 'note'],
  },
  {
    name: 'steps',
    columns: ['id', 'revision_id', 'sort_order', 'body', 'timer_sec', 'photo_id'],
  },
  {
    name: 'tags',
    columns: ['id', 'family_id', 'name', 'color'],
  },
  {
    name: 'recipe_tags',
    columns: ['recipe_id', 'tag_id'],
  },
  {
    name: 'cooking_logs',
    columns: [
      'id',
      'family_id',
      'recipe_id',
      'revision_id',
      'cooked_by',
      'cooked_at',
      'servings',
      'rating',
      'memo',
      'created_at',
    ],
  },
  {
    name: 'cooking_photos',
    columns: ['id', 'log_id', 'local_path', 'cloud_url', 'sort_order', 'taken_at', 'created_at'],
  },
  {
    name: 'memos',
    columns: ['id', 'recipe_id', 'author_id', 'body', 'is_private', 'created_at', 'updated_at'],
  },
  {
    name: 'sync_meta',
    columns: ['entity_type', 'entity_id', 'vector_clock', 'deleted_at', 'last_synced_at'],
  },
  {
    name: 'app_meta',
    columns: ['key', 'value', 'updated_at'],
  },
  // だいどこの在庫・買い物・名寄せ。移植時から**バックアップ対象に入っていなかった**
  // （WBS 2.8 のテーブル突き合わせで判明）。画面が残っているうちは一緒に持ち出す
  {
    name: 'shopping_items',
    columns: [
      'id',
      'family_id',
      'name',
      'name_normalized',
      'amount',
      'checked',
      'source',
      'recipe_id',
      'sort_order',
      'created_at',
      'checked_at',
    ],
  },
  {
    name: 'pantry_items',
    columns: [
      'id',
      'family_id',
      'name',
      'name_normalized',
      'quantity',
      'unit',
      'low_stock_threshold',
      'jan_code',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'name_aliases',
    columns: ['id', 'family_id', 'source_normalized', 'canonical', 'updated_at'],
  },

  // ─── さいえん手帳（R01〜R12）─────────────────────────────────────────
  // 並びは外部キーの向きどおり。復元は上から INSERT、削除は下から DELETE する
  {
    name: 'crops',
    columns: ['id', 'name', 'name_reading', 'family', 'default_unit', 'created_at', 'updated_at'],
  },
  {
    name: 'crop_calendars',
    columns: ['id', 'crop_id', 'region', 'kind', 'start_month', 'end_month'],
  },
  {
    name: 'crop_guides',
    columns: [
      'crop_id',
      'spacing_cm',
      'sunlight',
      'watering_note',
      'fertilize_after_days',
      'harvest_after_days',
      'common_pests',
      'tips',
    ],
  },
  {
    name: 'places',
    columns: [
      'id',
      'family_id',
      'name',
      'kind',
      'note',
      'sort_order',
      'archived_at',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'plantings',
    columns: [
      'id',
      'family_id',
      'crop_id',
      'crop_name',
      'crop_name_reading',
      'variety',
      'place_id',
      'planted_on',
      'planted_as',
      'cover_photo_path',
      'note',
      'ended_at',
      'ended_reason',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'planting_tags',
    columns: ['planting_id', 'tag_id'],
  },
  {
    name: 'care_logs',
    columns: ['id', 'planting_id', 'kind', 'logged_at', 'note', 'created_at', 'updated_at'],
  },
  {
    name: 'harvests',
    columns: [
      'id',
      'planting_id',
      'harvested_at',
      'quantity',
      'unit',
      'note',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'photos',
    columns: [
      'id',
      'owner_type',
      'owner_id',
      'local_path',
      'width',
      'height',
      'sort_order',
      'created_at',
    ],
  },
  {
    name: 'reminders',
    columns: [
      'id',
      'planting_id',
      'kind',
      'schedule_kind',
      'interval_days',
      'weekdays',
      'hour',
      'minute',
      'enabled',
      'last_fired_at',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'materials',
    columns: [
      'id',
      'family_id',
      'name',
      'category',
      'quantity',
      'unit',
      'low_threshold',
      'jan_code',
      'note',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'garden_shopping_items',
    columns: [
      'id',
      'family_id',
      'name',
      'name_normalized',
      'amount',
      'checked',
      'source',
      'material_id',
      'created_at',
      'checked_at',
    ],
  },
] as const;

type BackupTableName = (typeof BACKUP_TABLES)[number]['name'];
type BackupTables = Record<BackupTableName, BackupRow[]>;

/**
 * バックアップ対象のテーブル名。
 * 「新しく足したテーブルが漏れていないか」をテストで突き合わせるために公開する
 * （WBS 2.8 でさいえん手帳のテーブルが丸ごと抜けていた）。
 */
export const BACKUP_TABLE_NAMES: readonly string[] = BACKUP_TABLES.map((table) => table.name);

/**
 * わざとバックアップに入れないテーブル。
 *
 * どちらも取り直せるキャッシュで、利用者が書いたものではない。
 * バーコードの目録は端末に溜まると大きくなるため、持ち出しても得がない。
 * **新しいテーブルを黙って外さないための一覧**でもある（テストで突き合わせる）。
 */
export const BACKUP_EXCLUDED_TABLES: readonly string[] = [
  'jan_catalog', // バーコードの目録（引き直せる）
  'ingredient_nutrition', // 栄養価の取得結果（引き直せる）
];

export interface LocalBackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  tables: BackupTables;
}

export interface BackupFileSummary {
  uri: string;
  fileName: string;
  exportedAt: string | null;
  sizeBytes: number;
  modifiedAt: number;
}

export interface BackupOperationResult {
  uri: string;
  fileName: string;
  exportedAt: string;
  sizeBytes: number;
}

export interface MigrationPhotoManifestEntry {
  id: string;
  archivePath: string;
  fileName: string;
  originalLocalPath: string;
}

export interface MigrationBackupManifest {
  format: typeof MIGRATION_BACKUP_FORMAT;
  schemaVersion: typeof MIGRATION_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  backup: LocalBackupPayload;
  photos: MigrationPhotoManifestEntry[];
}

export interface MigrationBackupOperationResult extends BackupOperationResult {
  photoCount: number;
}

export interface MigrationBackupRestoreResult extends BackupOperationResult {
  restoredPhotoCount: number;
  missingPhotoCount: number;
}

function assertNative(): void {
  if (!isNativePlatform) {
    throw new Error('バックアップ・復元はネイティブアプリでのみ利用できます');
  }
}

function getBackupDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('ファイル保存領域を取得できませんでした');
  }
  return `${FileSystem.documentDirectory}${BACKUP_DIRECTORY_NAME}/`;
}

async function ensureBackupDirectory(): Promise<string> {
  const directory = getBackupDirectory();
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function formatDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatBackupFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());
  const hour = formatDatePart(date.getHours());
  const minute = formatDatePart(date.getMinutes());
  const second = formatDatePart(date.getSeconds());
  return `saien-backup-${year}${month}${day}-${hour}${minute}${second}.json`;
}

export function formatMigrationBackupFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());
  const hour = formatDatePart(date.getHours());
  const minute = formatDatePart(date.getMinutes());
  const second = formatDatePart(date.getSeconds());
  return `saien-transfer-${year}${month}${day}-${hour}${minute}${second}.saien.zip`;
}

function parseExportedAtFromFileName(fileName: string): string | null {
  const matched = /^saien-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(fileName);
  if (!matched) return null;
  const [, year, month, day, hour, minute, second] = matched;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function parseExportedAtFromMigrationFileName(fileName: string): string | null {
  const matched = /^saien-transfer-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.saien\.zip$/.exec(
    fileName,
  );
  if (!matched) return null;
  const [, year, month, day, hour, minute, second] = matched;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * BACKUP_TABLES から作る。手で並べ直していたときに
 * さいえん手帳のテーブルを足し忘れ、バックアップに栽培が 1 件も
 * 入らないことがあった（WBS 2.8）。定義はひとつに保つ。
 */
function createEmptyBackupTables(): BackupTables {
  return Object.fromEntries(
    BACKUP_TABLES.map((table) => [table.name, [] as BackupRow[]]),
  ) as unknown as BackupTables;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableColumnList(table: BackupTableDefinition): string {
  return table.columns.map(quoteIdentifier).join(', ');
}

function tablePlaceholders(table: BackupTableDefinition): string {
  return table.columns.map(() => '?').join(', ');
}

function isSqlValue(value: unknown): value is SqlValue {
  return value == null || typeof value === 'string' || typeof value === 'number';
}

function isBackupRow(value: unknown): value is BackupRow {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isSqlValue);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('バックアップ形式が不正です');
  }
  return parsed as Record<string, unknown>;
}

function parseLocalBackupPayloadObject(parsed: Record<string, unknown>): LocalBackupPayload {
  if (parsed.format !== BACKUP_FORMAT || parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('対応していないバックアップ形式です');
  }
  if (typeof parsed.exportedAt !== 'string') {
    throw new Error('バックアップ日時が不正です');
  }
  const rawTables = parsed.tables;
  if (rawTables == null || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
    throw new Error('バックアップテーブルが不正です');
  }

  const tables = createEmptyBackupTables();
  const tableRecord = rawTables as Record<string, unknown>;
  for (const table of BACKUP_TABLES) {
    const rows = tableRecord[table.name];
    if (!Array.isArray(rows) || !rows.every(isBackupRow)) {
      throw new Error(`${table.name} のバックアップ内容が不正です`);
    }
    tables[table.name] = rows;
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    tables,
  };
}

export function parseLocalBackupPayload(text: string): LocalBackupPayload {
  return parseLocalBackupPayloadObject(parseJsonObject(text));
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseMigrationPhotoEntry(value: unknown): MigrationPhotoManifestEntry {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('写真バックアップ情報が不正です');
  }
  const entry = value as Record<string, unknown>;
  const archivePath = assertString(entry.archivePath, '写真バックアップのパスが不正です');
  if (
    !archivePath.startsWith(`${MIGRATION_PHOTO_DIRECTORY_NAME}/`) ||
    archivePath.includes('..') ||
    archivePath.includes('\\')
  ) {
    throw new Error('写真バックアップのパスが不正です');
  }

  return {
    id: assertString(entry.id, '写真バックアップのIDが不正です'),
    archivePath,
    fileName: assertString(entry.fileName, '写真バックアップのファイル名が不正です'),
    originalLocalPath: assertString(entry.originalLocalPath, '写真バックアップの元パスが不正です'),
  };
}

export function parseMigrationBackupManifest(text: string): MigrationBackupManifest {
  const parsed = parseJsonObject(text);
  if (
    parsed.format !== MIGRATION_BACKUP_FORMAT ||
    parsed.schemaVersion !== MIGRATION_BACKUP_SCHEMA_VERSION
  ) {
    throw new Error('対応していない移行バックアップ形式です');
  }
  const exportedAt = assertString(parsed.exportedAt, '移行バックアップ日時が不正です');
  const rawBackup = parsed.backup;
  if (rawBackup == null || typeof rawBackup !== 'object' || Array.isArray(rawBackup)) {
    throw new Error('移行バックアップのデータが不正です');
  }
  const rawPhotos = parsed.photos;
  if (!Array.isArray(rawPhotos)) {
    throw new Error('写真バックアップ一覧が不正です');
  }

  return {
    format: MIGRATION_BACKUP_FORMAT,
    schemaVersion: MIGRATION_BACKUP_SCHEMA_VERSION,
    exportedAt,
    backup: parseLocalBackupPayloadObject(rawBackup as Record<string, unknown>),
    photos: rawPhotos.map(parseMigrationPhotoEntry),
  };
}

export function pickLatestBackup(files: BackupFileSummary[]): BackupFileSummary | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => {
    const modifiedDiff = b.modifiedAt - a.modifiedAt;
    return modifiedDiff !== 0 ? modifiedDiff : b.fileName.localeCompare(a.fileName);
  })[0];
}

function base64CharToValue(character: string): number {
  const value = BASE64_ALPHABET.indexOf(character);
  if (value < 0) {
    throw new Error('Base64 データが不正です');
  }
  return value;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, '');
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 4 === 1) {
    throw new Error('Base64 データが不正です');
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor((normalized.length * 3) / 4) - padding);
  let outputIndex = 0;

  for (let inputIndex = 0; inputIndex < normalized.length; inputIndex += 4) {
    const first = base64CharToValue(normalized[inputIndex]);
    const second = base64CharToValue(normalized[inputIndex + 1]);
    const thirdChar = normalized[inputIndex + 2];
    const fourthChar = normalized[inputIndex + 3];
    const third = thirdChar === '=' || thirdChar == null ? 0 : base64CharToValue(thirdChar);
    const fourth = fourthChar === '=' || fourthChar == null ? 0 : base64CharToValue(fourthChar);
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (outputIndex < bytes.length) bytes[outputIndex++] = (combined >> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = combined & 0xff;
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 3) {
    const first = bytes[byteIndex];
    const second = bytes[byteIndex + 1];
    const third = bytes[byteIndex + 2];
    const hasSecond = byteIndex + 1 < bytes.length;
    const hasThird = byteIndex + 2 < bytes.length;
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    chunks.push(
      BASE64_ALPHABET[(combined >> 18) & 0x3f],
      BASE64_ALPHABET[(combined >> 12) & 0x3f],
      hasSecond ? BASE64_ALPHABET[(combined >> 6) & 0x3f] : '=',
      hasThird ? BASE64_ALPHABET[combined & 0x3f] : '=',
    );
  }
  return chunks.join('');
}

function sanitizeArchiveFileName(value: string): string {
  return value
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fileNameFromUri(uri: string, fallback: string): string {
  const path = uri.split(/[?#]/)[0];
  const rawName = path.split('/').filter(Boolean).pop() ?? fallback;
  const sanitized = sanitizeArchiveFileName(rawName);
  return sanitized || fallback;
}

export function createMigrationPhotoArchivePath(photoId: string, localPath: string): string {
  const safeId = sanitizeArchiveFileName(photoId) || 'photo';
  const fileName = fileNameFromUri(localPath, `${safeId}.jpg`);
  return `${MIGRATION_PHOTO_DIRECTORY_NAME}/${safeId}-${fileName}`;
}

function getRequiredDocumentDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('ファイル保存領域を取得できませんでした');
  }
  return FileSystem.documentDirectory;
}

async function ensureRestoredPhotoDirectory(): Promise<string> {
  const directory = `${getRequiredDocumentDirectory()}${MIGRATION_PHOTO_DIRECTORY_NAME}/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function rowString(row: BackupRow, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 写真のファイルパスを持つテーブル。
 *
 * さいえん手帳の写真は `photos`（作業ログ・収穫の共用）に入る。
 * だいどこの `cooking_photos` も残しているのは、画面がまだ消えていないため。
 * `plantings.cover_photo_path` は id ではなく行を主キーで引くので別扱い。
 */
const PHOTO_SOURCES = [
  { table: 'photos', idColumn: 'id', pathColumn: 'local_path' },
  { table: 'cooking_photos', idColumn: 'id', pathColumn: 'local_path' },
  { table: 'plantings', idColumn: 'id', pathColumn: 'cover_photo_path' },
] as const;

/** アーカイブ内で一意になる鍵。テーブルをまたいで id が衝突しても混ざらない */
function photoKey(table: string, id: string): string {
  return `${table}:${id}`;
}

function updatePhotoLocalPath(
  payload: LocalBackupPayload,
  key: string,
  localPath: string | null,
): void {
  for (const source of PHOTO_SOURCES) {
    const [table, id] = [source.table, key.slice(source.table.length + 1)];
    if (!key.startsWith(`${table}:`)) continue;
    const row = payload.tables[table].find((candidate) => candidate[source.idColumn] === id);
    if (row) row[source.pathColumn] = localPath;
    return;
  }
}

function clearPhotoLocalPaths(payload: LocalBackupPayload): void {
  for (const source of PHOTO_SOURCES) {
    for (const row of payload.tables[source.table]) {
      row[source.pathColumn] = null;
    }
  }
}

function cloneBackupPayload(payload: LocalBackupPayload): LocalBackupPayload {
  return parseLocalBackupPayload(JSON.stringify(payload));
}

/** いまの DB から丸ごと吸い出す。ファイルには書かない（テストから直接叩ける） */
export function createBackupPayloadFromDatabase(): LocalBackupPayload {
  const expoDb = getExpoDb();
  const tables = createEmptyBackupTables();

  for (const table of BACKUP_TABLES) {
    tables[table.name] = expoDb.getAllSync<BackupRow>(
      `SELECT ${tableColumnList(table)} FROM ${quoteIdentifier(table.name)}`,
    );
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

export async function listLocalBackups(): Promise<BackupFileSummary[]> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const files = await FileSystem.readDirectoryAsync(directory);
  const backupFiles = files.filter((fileName) => /^saien-backup-\d{8}-\d{6}\.json$/.test(fileName));

  const summaries = await Promise.all(
    backupFiles.map(async (fileName) => {
      const uri = `${directory}${fileName}`;
      const info = await FileSystem.getInfoAsync(uri);
      return {
        uri,
        fileName,
        exportedAt: parseExportedAtFromFileName(fileName),
        sizeBytes: info.exists && typeof info.size === 'number' ? info.size : 0,
        modifiedAt:
          info.exists && typeof info.modificationTime === 'number' ? info.modificationTime : 0,
      };
    }),
  );

  return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function listMigrationBackupPackages(): Promise<BackupFileSummary[]> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const files = await FileSystem.readDirectoryAsync(directory);
  const backupFiles = files.filter((fileName) =>
    /^saien-transfer-\d{8}-\d{6}\.saien\.zip$/.test(fileName),
  );

  const summaries = await Promise.all(
    backupFiles.map(async (fileName) => {
      const uri = `${directory}${fileName}`;
      const info = await FileSystem.getInfoAsync(uri);
      return {
        uri,
        fileName,
        exportedAt: parseExportedAtFromMigrationFileName(fileName),
        sizeBytes: info.exists && typeof info.size === 'number' ? info.size : 0,
        modifiedAt:
          info.exists && typeof info.modificationTime === 'number' ? info.modificationTime : 0,
      };
    }),
  );

  return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function createLocalBackup(): Promise<BackupOperationResult> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const payload = createBackupPayloadFromDatabase();
  const fileName = formatBackupFileName(new Date(payload.exportedAt));
  const uri = `${directory}${fileName}`;

  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
  };
}

export async function createMigrationBackupPackage(): Promise<MigrationBackupOperationResult> {
  assertNative();
  const directory = await ensureBackupDirectory();
  const payload = createBackupPayloadFromDatabase();
  const zipEntries: Record<string, Uint8Array> = {};
  const photos: MigrationPhotoManifestEntry[] = [];

  // 写真は「作業ログ・収穫（photos）」「栽培のカバー」「だいどこの調理写真」の 3 か所
  for (const source of PHOTO_SOURCES) {
    for (const row of payload.tables[source.table]) {
      const rowId = rowString(row, source.idColumn);
      const localPath = rowString(row, source.pathColumn);
      if (!rowId || !localPath) continue;

      const key = photoKey(source.table, rowId);
      const info = await FileSystem.getInfoAsync(localPath);
      if (!info.exists) {
        // 端末から消えている写真は、復元先で「無い写真」を指さないよう空にする
        updatePhotoLocalPath(payload, key, null);
        continue;
      }

      const archivePath = createMigrationPhotoArchivePath(key, localPath);
      const fileName = archivePath.split('/').pop() ?? `${rowId}.jpg`;
      const photoBase64 = await FileSystem.readAsStringAsync(localPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      zipEntries[archivePath] = base64ToUint8Array(photoBase64);
      photos.push({ id: key, archivePath, fileName, originalLocalPath: localPath });
    }
  }

  const manifest: MigrationBackupManifest = {
    format: MIGRATION_BACKUP_FORMAT,
    schemaVersion: MIGRATION_BACKUP_SCHEMA_VERSION,
    exportedAt: payload.exportedAt,
    backup: payload,
    photos,
  };
  zipEntries[MIGRATION_MANIFEST_FILE_NAME] = strToU8(JSON.stringify(manifest, null, 2));

  const zipBytes = zipSync(zipEntries, { level: 6 });
  const fileName = formatMigrationBackupFileName(new Date(payload.exportedAt));
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(zipBytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
    photoCount: photos.length,
  };
}

/** DB の中身をバックアップの内容で置き換える。索引の作り直しは呼び出し側 */
export function replaceDatabase(payload: LocalBackupPayload): void {
  const expoDb = getExpoDb();

  expoDb.execSync('PRAGMA foreign_keys = OFF');
  expoDb.execSync('BEGIN TRANSACTION');
  try {
    for (const table of [...BACKUP_TABLES].reverse()) {
      expoDb.runSync(`DELETE FROM ${quoteIdentifier(table.name)}`);
    }

    for (const table of BACKUP_TABLES) {
      const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${tableColumnList(table)}) VALUES (${tablePlaceholders(table)})`;
      for (const row of payload.tables[table.name]) {
        expoDb.runSync(
          sql,
          table.columns.map((column) => row[column] ?? null),
        );
      }
    }
    expoDb.execSync('COMMIT');
  } catch (error) {
    expoDb.execSync('ROLLBACK');
    throw error;
  } finally {
    expoDb.execSync('PRAGMA foreign_keys = ON');
  }
}

/**
 * 検索の索引を張り直す。
 * **栽培の索引（planting_fts）も必ず一緒に**。片方だけだと、復元した直後に
 * 「一覧には出るのに検索で出ない」栽培ができる。
 */
async function rebuildSearchIndexes(): Promise<void> {
  const db = getDb();
  await rebuildFts(db);
  await rebuildPlantingFts(db);
}

export async function restoreLocalBackup(uri: string): Promise<BackupOperationResult> {
  assertNative();
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  const payload = parseLocalBackupPayload(raw);

  replaceDatabase(payload);
  await rebuildSearchIndexes();

  const fileName = uri.split('/').pop() ?? 'backup.json';
  return {
    uri,
    fileName,
    exportedAt: payload.exportedAt,
    sizeBytes: await fileSize(uri),
  };
}

export async function restoreMigrationBackupPackage(
  uri: string,
): Promise<MigrationBackupRestoreResult> {
  assertNative();
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const entries = unzipSync(base64ToUint8Array(raw));
  const manifestEntry = entries[MIGRATION_MANIFEST_FILE_NAME];
  if (!manifestEntry) {
    throw new Error('移行バックアップの manifest が見つかりません');
  }

  const manifest = parseMigrationBackupManifest(strFromU8(manifestEntry));
  const payload = cloneBackupPayload(manifest.backup);
  clearPhotoLocalPaths(payload);
  const photoDirectory = await ensureRestoredPhotoDirectory();
  const copiedPhotoUris: string[] = [];
  let restoredPhotoCount = 0;

  try {
    for (const photo of manifest.photos) {
      const photoEntry = entries[photo.archivePath];
      if (!photoEntry) {
        updatePhotoLocalPath(payload, photo.id, null);
        continue;
      }

      const destinationFileName = fileNameFromUri(photo.fileName, `${photo.id}.jpg`);
      const destination = `${photoDirectory}${destinationFileName}`;
      await FileSystem.writeAsStringAsync(destination, uint8ArrayToBase64(photoEntry), {
        encoding: FileSystem.EncodingType.Base64,
      });
      copiedPhotoUris.push(destination);
      updatePhotoLocalPath(payload, photo.id, destination);
      restoredPhotoCount += 1;
    }

    replaceDatabase(payload);
    await rebuildSearchIndexes();
  } catch (error) {
    await Promise.all(
      copiedPhotoUris.map((photoUri) => FileSystem.deleteAsync(photoUri, { idempotent: true })),
    );
    throw error;
  }

  const fileName = uri.split('/').pop() ?? 'migration-backup.saien.zip';
  return {
    uri,
    fileName,
    exportedAt: manifest.exportedAt,
    sizeBytes: await fileSize(uri),
    restoredPhotoCount,
    missingPhotoCount: manifest.photos.length - restoredPhotoCount,
  };
}

export async function restoreLatestLocalBackup(): Promise<BackupOperationResult> {
  const latest = pickLatestBackup(await listLocalBackups());
  if (!latest) {
    throw new Error('復元できるバックアップがありません');
  }
  return restoreLocalBackup(latest.uri);
}

// ─── 週次の自動スナップショット（R13 / WBS 2.8）─────────────────────────

/** 何日おきに自動で取るか */
export const AUTO_BACKUP_INTERVAL_DAYS = 7;

/** 自動で取ったものを何世代残すか。古いものから消す */
export const AUTO_BACKUP_KEEP = 4;

const DAY_MS = 86_400_000;

/**
 * 自動バックアップを取るべきか。
 *
 * 1 度も取っていなければ取る。前回から `AUTO_BACKUP_INTERVAL_DAYS` 日
 * **以上**空いていれば取る（ちょうど 7 日目に取る）。
 *
 * 純関数にしているのは、ここがずれても誰も気づけないから。
 * 「毎回取る」と端末が容量で埋まり、「一生取らない」と気づかないまま失われる。
 */
export function shouldCreateAutoBackup(
  latest: BackupFileSummary | null,
  now: Date = new Date(),
): boolean {
  if (!latest) return true;

  const previous = latest.exportedAt ? new Date(latest.exportedAt) : null;
  if (!previous || Number.isNaN(previous.getTime())) return true;

  return now.getTime() - previous.getTime() >= AUTO_BACKUP_INTERVAL_DAYS * DAY_MS;
}

/** 新しいものから `keep` 件だけ残し、古いものを消す。消した件数を返す */
export async function pruneOldBackups(keep: number = AUTO_BACKUP_KEEP): Promise<number> {
  assertNative();
  const backups = await listLocalBackups(); // 新しい順
  const stale = backups.slice(Math.max(0, keep));

  for (const backup of stale) {
    await FileSystem.deleteAsync(backup.uri, { idempotent: true });
  }
  return stale.length;
}

/**
 * 起動時に呼ぶ。前回から間が空いていれば静かに 1 世代取り、古いものを整理する。
 * 取らなかったときは null。
 *
 * 写真は含めない（JSON だけ）。写真は端末に残っているので、週ごとに複製すると
 * 容量だけが増えていく。機種変更のときは写真入りの移行ファイルを別に作る。
 */
export async function runWeeklyAutoBackup(
  now: Date = new Date(),
): Promise<BackupOperationResult | null> {
  if (!isNativePlatform) return null;

  const latest = pickLatestBackup(await listLocalBackups());
  if (!shouldCreateAutoBackup(latest, now)) return null;

  const result = await createLocalBackup();
  await pruneOldBackups();
  return result;
}

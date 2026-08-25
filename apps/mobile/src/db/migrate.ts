/**
 * Database migration and optional sample seeding
 * Uses raw SQL for table creation (expo-sqlite doesn't support Drizzle migrations natively)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import { normalizeForSearch } from '../services/fts.service';
import { CROP_MASTER, CROP_MASTER_VERSION } from './crop-master';
import * as schema from './schema';
import { isSampleDataEnabled } from './sampleData';
import { seedSamplePhotos } from './seed-photos';
import {
  seedCareLogs,
  seedCropCalendars,
  seedCropGuides,
  seedCrops,
  seedFamilies,
  seedHarvestPhotoReads,
  seedHarvests,
  seedMaterials,
  seedPlaces,
  seedPlantingTagMasters,
  seedPlantingTags,
  seedPlantings,
  seedUsers,
} from './seed';

type DB = ExpoSQLiteDatabase<typeof schema>;

// v9: garden_shopping_items（WBS 2.7）
// v10: crop_calendars の一意インデックスに start_month を追加（WBS 3.1。
//      同じ kind でも春秋 2 つの窓を持てるように）
// v11: だいどこ由来テーブルを DROP（WBS 2.9e。処分表は docs/WBS.md §2.9）
// v12: harvest_photo_reads（「写真から記録」の読み取り状態 — #143）
export const CURRENT_SCHEMA_VERSION = 13;

const DEFAULT_USER_ID = 'user-kei';
const DEFAULT_FAMILY_ID = 'family-001';
const DEFAULT_MEMBER_ID = 'member-family-001-user-kei';
const DEFAULT_USER_NAME = '';
const DEFAULT_FAMILY_NAME = 'わたしの菜園';
const DEFAULT_INVITE_CODE = 'DK0001';

// サンプルデータの中身を変えたら必ず上げる。据え置くと、既にシード済みの端末は
// appMeta のマーカーが一致して seedDatabase() が即 return し、新しい行が入らない。
const SAMPLE_DATA_VERSION = '8';
const SAMPLE_DATA_META_KEY = 'sample_data_version';

export interface SeedSnapshot {
  userIds: string[];
  familyIds: string[];
  tagIds: string[];
  placeIds: string[];
  plantingIds: string[];
  careLogIds: string[];
  harvestIds: string[];
  materialIds: string[];
}

export interface MigrationResult {
  schemaVersion: number;
}

// 「利用者が作ったデータの上にサンプルを重ねない」判定の対象。
// WBS 2.9c でだいどこのレシピ・調理記録から栽培側の記録へ差し替えた。
const seedIdSets = {
  userIds: new Set(seedUsers.map((item) => item.id)),
  familyIds: new Set(seedFamilies.map((item) => item.id)),
  tagIds: new Set(seedPlantingTagMasters.map((item) => item.id)),
  placeIds: new Set(seedPlaces.map((item) => item.id)),
  plantingIds: new Set(seedPlantings.map((item) => item.id)),
  careLogIds: new Set(seedCareLogs.map((item) => item.id)),
  harvestIds: new Set(seedHarvests.map((item) => item.id)),
  materialIds: new Set(seedMaterials.map((item) => item.id)),
} satisfies Record<keyof SeedSnapshot, Set<string>>;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    UNIQUE(family_id, user_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_family_user ON family_members(family_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_family_members_family ON family_members(family_id);

  -- users / families / family_members はさいえん手帳でも恒久的に使う
  -- （R19 のグループ共有まで、だいどこの families 構造をそのまま流用）

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    color TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_family_name ON tags(family_id, name);

  CREATE TABLE IF NOT EXISTS sync_meta (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    vector_clock TEXT NOT NULL,
    deleted_at TEXT,
    last_synced_at TEXT,
    PRIMARY KEY (entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ══════════════════════════════════════════════════════════════════════
  -- さいえん手帳（v8 / WBS 1.3）
  -- だいどこの recipes 系テーブルは WBS 2.9e で DROP 済み（本ファイル下部の
  -- DAIDOKO_TABLES_TO_DROP）。詳細は docs/データ設計.md
  -- ══════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS crops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_reading TEXT,
    family TEXT,
    default_unit TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crop_calendars (
    id TEXT PRIMARY KEY,
    crop_id TEXT NOT NULL REFERENCES crops(id),
    region TEXT NOT NULL,
    kind TEXT NOT NULL,
    start_month INTEGER NOT NULL,
    end_month INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_crop_calendars_crop_region_kind_start
    ON crop_calendars(crop_id, region, kind, start_month);

  CREATE TABLE IF NOT EXISTS crop_guides (
    crop_id TEXT PRIMARY KEY REFERENCES crops(id),
    spacing_cm INTEGER,
    sunlight TEXT,
    watering_note TEXT,
    fertilize_after_days INTEGER,
    harvest_after_days INTEGER,
    common_pests TEXT,
    tips TEXT
  );

  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    kind TEXT,
    note TEXT,
    sort_order INTEGER,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_places_family ON places(family_id);

  CREATE TABLE IF NOT EXISTS plantings (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    crop_id TEXT REFERENCES crops(id),
    crop_name TEXT NOT NULL,
    crop_name_reading TEXT,
    variety TEXT,
    place_id TEXT REFERENCES places(id),
    planted_on TEXT NOT NULL,
    planted_as TEXT NOT NULL,
    cover_photo_path TEXT,
    note TEXT,
    ended_at TEXT,
    ended_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_plantings_family_ended ON plantings(family_id, ended_at);
  CREATE INDEX IF NOT EXISTS idx_plantings_place ON plantings(place_id);
  CREATE INDEX IF NOT EXISTS idx_plantings_crop ON plantings(crop_id);

  CREATE TABLE IF NOT EXISTS planting_tags (
    planting_id TEXT NOT NULL REFERENCES plantings(id),
    tag_id TEXT NOT NULL REFERENCES tags(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_planting_tags_pk ON planting_tags(planting_id, tag_id);
  CREATE INDEX IF NOT EXISTS idx_planting_tags_tag ON planting_tags(tag_id);

  CREATE TABLE IF NOT EXISTS care_logs (
    id TEXT PRIMARY KEY,
    planting_id TEXT NOT NULL REFERENCES plantings(id),
    kind TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_care_logs_planting_date ON care_logs(planting_id, logged_at);
  CREATE INDEX IF NOT EXISTS idx_care_logs_date ON care_logs(logged_at);

  CREATE TABLE IF NOT EXISTS harvests (
    id TEXT PRIMARY KEY,
    planting_id TEXT NOT NULL REFERENCES plantings(id),
    harvested_at TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_harvests_planting_date ON harvests(planting_id, harvested_at);
  CREATE INDEX IF NOT EXISTS idx_harvests_date ON harvests(harvested_at);

  -- 「写真から記録」の読み取り状態（#143 / v12）。詳細は schema.ts のコメント
  CREATE TABLE IF NOT EXISTS harvest_photo_reads (
    harvest_id TEXT PRIMARY KEY REFERENCES harvests(id),
    state TEXT NOT NULL DEFAULT 'pending',
    paid INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    crop_guess TEXT,
    crop_confidence TEXT,
    count INTEGER,
    count_confidence TEXT,
    read_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_harvest_photo_reads_state ON harvest_photo_reads(state);

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    local_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_type, owner_id);

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    planting_id TEXT NOT NULL REFERENCES plantings(id),
    kind TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    interval_days INTEGER,
    weekdays TEXT,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    last_fired_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_planting ON reminders(planting_id);

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    low_threshold REAL,
    jan_code TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_materials_family_category ON materials(family_id, category);

  -- R12 買い物リスト。食材の shopping_items とは別（混ざると菜園のメモに牛乳が並ぶ）
  CREATE TABLE IF NOT EXISTS garden_shopping_items (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id),
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    amount TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    material_id TEXT REFERENCES materials(id),
    created_at TEXT NOT NULL,
    checked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_garden_shopping_family_checked ON garden_shopping_items(family_id, checked);

  -- R03 栽培一覧・検索。recipe_fts と同じ方式（正規化は fts.service.ts を流用）
  CREATE VIRTUAL TABLE IF NOT EXISTS planting_fts USING fts5(
    planting_id UNINDEXED,
    crop_name,
    crop_name_reading,
    variety,
    tag_names,
    tokenize='unicode61'
  );
`;

// Columns added after a table first shipped (SQLite has no ADD COLUMN IF NOT
// EXISTS — the duplicate-column error on re-run is expected and swallowed).
// v7 で追加した recipes.cover_photo_path / steps.photo_path は、両テーブルごと
// WBS 2.9e で DROP した。今は空だが、将来の列追加のためにしくみは残す。
const ADD_COLUMN_MIGRATIONS: { table: string; columnDdl: string }[] = [];

/**
 * だいどこ専用だったテーブル（WBS 2.9e で DROP）。
 *
 * 新規インストールでは CREATE_TABLES_SQL がそもそも作らないので無害。
 * 既存の開発端末だけ、ここで実際に消える。子 → 親の順に並べているが、
 * 外部キー違反を確実に避けるため一時的に PRAGMA foreign_keys = OFF で実行する
 * （backup.service.ts の replaceDatabase と同じ考え方）。
 */
const DAIDOKO_TABLES_TO_DROP = [
  'ingredient_nutrition',
  'recipe_tags',
  'cooking_photos',
  'cooking_logs',
  'memos',
  'steps',
  'ingredients',
  'recipe_revisions',
  'recipes',
  'sources',
  'shopping_items',
  'pantry_items',
  'jan_catalog',
  'name_aliases',
  'recipe_fts',
] as const;

/** v13 の相対化対象。photo-path.ts の PHOTO_DIRECTORIES と揃える */
const PHOTO_DIRECTORY_NAMES = [
  'garden-photos/',
  'recipe-photos/',
  'cooking-photos/',
  'backup-photos/',
] as const;

/** 写真パスを持つ列 */
const PHOTO_PATH_COLUMNS = [
  ['photos', 'local_path'],
  ['plantings', 'cover_photo_path'],
] as const;

/** Run migrations (create tables + additive column changes) */
export function runMigrations(expoDb: { execSync: (sql: string) => void }): MigrationResult {
  expoDb.execSync(CREATE_TABLES_SQL);
  // v10: 3 列の旧一意インデックスが残っていると、同じ kind の 2 つ目の窓
  // （ジャガイモの春植え・秋植えなど）が UNIQUE 違反になるため先に落とす
  expoDb.execSync('DROP INDEX IF EXISTS idx_crop_calendars_crop_region_kind');

  // v11: だいどこ由来テーブルを DROP（WBS 2.9e）
  expoDb.execSync('PRAGMA foreign_keys = OFF');
  for (const table of DAIDOKO_TABLES_TO_DROP) {
    expoDb.execSync(`DROP TABLE IF EXISTS ${table}`);
  }
  expoDb.execSync('PRAGMA foreign_keys = ON');

  for (const { table, columnDdl } of ADD_COLUMN_MIGRATIONS) {
    try {
      expoDb.execSync(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
    } catch {
      // column already exists (fresh install or already migrated)
    }
  }
  // v13: 写真パスを相対化する。
  // 以前は `file:///…/Documents/garden-photos/x.jpg` のような絶対パスを保存していたが、
  // **iOS はアプリのデータコンテナ UUID が再インストール・端末復元で変わる**ため、
  // バックアップを入れ直すと全写真のパスが無効になり画面が空白になっていた。
  // instr が 1 を返す行（既に相対）は書き換えないので、毎起動走っても冪等。
  for (const directory of PHOTO_DIRECTORY_NAMES) {
    for (const [table, column] of PHOTO_PATH_COLUMNS) {
      expoDb.execSync(
        `UPDATE ${table} SET ${column} = substr(${column}, instr(${column}, '${directory}')) ` +
          `WHERE ${column} IS NOT NULL AND instr(${column}, '${directory}') > 1`,
      );
    }
  }

  expoDb.execSync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  return { schemaVersion: CURRENT_SCHEMA_VERSION };
}

export async function ensureLocalIdentity(database: DB): Promise<void> {
  const now = new Date().toISOString();

  await database
    .insert(schema.users)
    .values({
      id: DEFAULT_USER_ID,
      displayName: DEFAULT_USER_NAME,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await database
    .insert(schema.families)
    .values({
      id: DEFAULT_FAMILY_ID,
      name: DEFAULT_FAMILY_NAME,
      inviteCode: DEFAULT_INVITE_CODE,
      ownerId: DEFAULT_USER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  if (!isSampleDataEnabled()) {
    await database
      .update(schema.users)
      .set({ displayName: DEFAULT_USER_NAME, updatedAt: now })
      .where(
        and(
          eq(schema.users.id, DEFAULT_USER_ID),
          inArray(schema.users.displayName, ['恵', 'あなた']),
        ),
      );
  }

  // だいどこ時代の既定名から引っ越す（WBS 2.9c）。利用者が付けた名前は触らない
  await database
    .update(schema.families)
    .set({ name: DEFAULT_FAMILY_NAME, updatedAt: now })
    .where(
      and(
        eq(schema.families.id, DEFAULT_FAMILY_ID),
        inArray(schema.families.name, ['わたしの台所', '佐藤家の台所']),
      ),
    );

  await database
    .insert(schema.familyMembers)
    .values({
      id: DEFAULT_MEMBER_ID,
      familyId: DEFAULT_FAMILY_ID,
      userId: DEFAULT_USER_ID,
      role: 'owner',
      joinedAt: now,
    })
    .onConflictDoNothing();
}

const CROP_MASTER_META_KEY = 'crop_master_version';

/**
 * 作物マスター（栽培暦・作物ガイド）を投入する（R08/R09 / WBS 3.1）。
 *
 * サンプルデータと違い**本番でも常に**走る。アプリ更新でマスターが増えたら、
 * CROP_MASTER_VERSION の差分で検知して入れ直す。
 *
 * 窓とガイドは「マスターに載っている作物の分だけ」削除 → 挿入で入れ替える。
 * 開発用サンプル（seed.ts の crop-tomato など）には触らない。
 */
export async function syncCropMaster(database: DB): Promise<void> {
  const meta = await database
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, CROP_MASTER_META_KEY))
    .limit(1);
  if (meta[0]?.value === String(CROP_MASTER_VERSION)) return;

  const now = new Date().toISOString();
  const masterIds = CROP_MASTER.map((crop) => crop.id);

  for (const crop of CROP_MASTER) {
    await database
      .insert(schema.crops)
      .values({
        id: crop.id,
        name: crop.name,
        nameReading: crop.nameReading,
        family: crop.family,
        defaultUnit: crop.defaultUnit,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.crops.id,
        set: {
          name: crop.name,
          nameReading: crop.nameReading,
          family: crop.family,
          defaultUnit: crop.defaultUnit,
          updatedAt: now,
        },
      });
  }

  await database
    .delete(schema.cropCalendars)
    .where(inArray(schema.cropCalendars.cropId, masterIds));
  for (const crop of CROP_MASTER) {
    for (const window of crop.calendars) {
      await database.insert(schema.cropCalendars).values({
        id: `${crop.id}-${window.region}-${window.kind}-${window.startMonth}`,
        cropId: crop.id,
        region: window.region,
        kind: window.kind,
        startMonth: window.startMonth,
        endMonth: window.endMonth,
      });
    }
  }

  await database.delete(schema.cropGuides).where(inArray(schema.cropGuides.cropId, masterIds));
  for (const crop of CROP_MASTER) {
    await database.insert(schema.cropGuides).values({
      cropId: crop.id,
      spacingCm: crop.guide.spacingCm,
      sunlight: crop.guide.sunlight,
      wateringNote: crop.guide.wateringNote,
      fertilizeAfterDays: crop.guide.fertilizeAfterDays,
      harvestAfterDays: crop.guide.harvestAfterDays,
      commonPests: JSON.stringify(crop.guide.commonPests),
      tips: crop.guide.tips,
    });
  }

  await database
    .insert(schema.appMeta)
    .values({ key: CROP_MASTER_META_KEY, value: String(CROP_MASTER_VERSION), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.appMeta.key,
      set: { value: String(CROP_MASTER_VERSION), updatedAt: now },
    });
}

function isSubsetOfSeed(ids: string[], seedIds: Set<string>): boolean {
  return ids.every((id) => seedIds.has(id));
}

export function shouldInstallSampleData(snapshot: SeedSnapshot): boolean {
  const allIds = Object.values(snapshot).flat();
  if (allIds.length === 0) return true;

  return (Object.keys(seedIdSets) as (keyof SeedSnapshot)[]).every((key) =>
    isSubsetOfSeed(snapshot[key], seedIdSets[key]),
  );
}

async function getSeedSnapshot(database: DB): Promise<SeedSnapshot> {
  const users = await database.select({ id: schema.users.id }).from(schema.users);
  const families = await database.select({ id: schema.families.id }).from(schema.families);
  const tags = await database.select({ id: schema.tags.id }).from(schema.tags);
  const places = await database.select({ id: schema.places.id }).from(schema.places);
  const plantings = await database.select({ id: schema.plantings.id }).from(schema.plantings);
  const careLogs = await database.select({ id: schema.careLogs.id }).from(schema.careLogs);
  const harvests = await database.select({ id: schema.harvests.id }).from(schema.harvests);
  const materials = await database.select({ id: schema.materials.id }).from(schema.materials);

  return {
    userIds: users.map((item) => item.id),
    familyIds: families.map((item) => item.id),
    tagIds: tags.map((item) => item.id),
    placeIds: places.map((item) => item.id),
    plantingIds: plantings.map((item) => item.id),
    careLogIds: careLogs.map((item) => item.id),
    harvestIds: harvests.map((item) => item.id),
    materialIds: materials.map((item) => item.id),
  };
}

async function markSampleDataVersion(database: DB): Promise<void> {
  await database
    .insert(schema.appMeta)
    .values({
      key: SAMPLE_DATA_META_KEY,
      value: SAMPLE_DATA_VERSION,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.appMeta.key,
      set: {
        value: SAMPLE_DATA_VERSION,
        updatedAt: new Date().toISOString(),
      },
    });
}

/** Seed the database with sample data */
export async function seedDatabase(database: DB): Promise<void> {
  if (!isSampleDataEnabled()) return;

  const seedMeta = await database
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, SAMPLE_DATA_META_KEY))
    .limit(1);
  if (seedMeta[0]?.value === SAMPLE_DATA_VERSION) return;

  const snapshot = await getSeedSnapshot(database);
  if (!shouldInstallSampleData(snapshot)) {
    await markSampleDataVersion(database);
    return;
  }

  // Insert in order to satisfy foreign key constraints
  await database
    .insert(schema.users)
    .values([...seedUsers])
    .onConflictDoNothing();
  // migrate() が既定ユーザー（表示名空）を先に作るため、onConflictDoNothing では
  // サンプルの表示名が反映されない。未設定のままの場合だけ見本の名前を補う。
  await database
    .update(schema.users)
    .set({ displayName: seedUsers[0].displayName })
    .where(and(eq(schema.users.id, seedUsers[0].id), eq(schema.users.displayName, '')));
  await database
    .insert(schema.families)
    .values([...seedFamilies])
    .onConflictDoNothing();
  // ── さいえん手帳（WBS 1.5）─────────────────────────────────────────────
  // 作物マスターの本番データ投入は WBS 3.1。ここは画面確認用の最小セット
  await database
    .insert(schema.crops)
    .values([...seedCrops])
    .onConflictDoNothing();
  await database
    .insert(schema.cropGuides)
    .values([...seedCropGuides])
    .onConflictDoNothing();
  await database
    .insert(schema.cropCalendars)
    .values([...seedCropCalendars])
    .onConflictDoNothing();
  await database
    .insert(schema.places)
    .values([...seedPlaces])
    .onConflictDoNothing();
  await database
    .insert(schema.plantings)
    .values([...seedPlantings])
    .onConflictDoNothing();
  await database
    .insert(schema.tags)
    .values([...seedPlantingTagMasters])
    .onConflictDoNothing();
  await database
    .insert(schema.plantingTags)
    .values([...seedPlantingTags])
    .onConflictDoNothing();
  await database
    .insert(schema.careLogs)
    .values([...seedCareLogs])
    .onConflictDoNothing();
  await database
    .insert(schema.harvests)
    .values([...seedHarvests])
    .onConflictDoNothing();
  await database
    .insert(schema.harvestPhotoReads)
    .values([...seedHarvestPhotoReads])
    .onConflictDoNothing();
  await database
    .insert(schema.materials)
    .values([...seedMaterials])
    .onConflictDoNothing();

  // 掲載スクリーンショット用の写真（WBS 3.8）。失敗しても投げない
  await seedSamplePhotos(database);

  // Populate FTS index
  await rebuildPlantingFts(database);
  await markSampleDataVersion(database);
}

/**
 * planting_fts を作り直す（R03 の検索）。
 * 投入時の正規化は fts.service の normalizeForSearch を共有する。
 * ここで別の正規化をすると「登録したのに検索で出ない」が起きる。
 */
export async function rebuildPlantingFts(database: DB): Promise<void> {
  await database.run(sql`DELETE FROM planting_fts`);

  const allPlantings = await database.select().from(schema.plantings);

  for (const planting of allPlantings) {
    const tagRows = await database
      .select({ name: schema.tags.name })
      .from(schema.plantingTags)
      .leftJoin(schema.tags, eq(schema.plantingTags.tagId, schema.tags.id))
      .where(eq(schema.plantingTags.plantingId, planting.id));
    const tagNames = tagRows.map((row) => row.name ?? '').join(' ');

    await database.run(
      sql`INSERT INTO planting_fts (planting_id, crop_name, crop_name_reading, variety, tag_names)
          VALUES (${planting.id}, ${normalizeForSearch(planting.cropName)},
                  ${normalizeForSearch(planting.cropNameReading ?? '')},
                  ${normalizeForSearch(planting.variety ?? '')},
                  ${normalizeForSearch(tagNames)})`,
    );
  }
}

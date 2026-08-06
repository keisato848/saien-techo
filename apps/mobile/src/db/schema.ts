/**
 * SQLite schema for だいどこ mobile app
 * Drizzle ORM (expo-sqlite) definitions
 *
 * Entities: User, Family, FamilyMember, Recipe, RecipeRevision, Ingredient, Step,
 *           Tag, RecipeTag, Source, CookingLog, CookingPhoto, Memo, SyncMeta, AppMeta
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── User ──────────────────────���────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Family ──────────────────────��──────────────────────────────────────────
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FamilyMember ──────────────────────────────────────────────────────────
export const familyMembers = sqliteTable(
  'family_members',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'), // 'owner' | 'member'
    joinedAt: text('joined_at').notNull(),
  },
  (table) => ({
    familyUserIdx: uniqueIndex('idx_family_members_family_user').on(table.familyId, table.userId),
    familyIdx: index('idx_family_members_family').on(table.familyId),
  }),
);

// ─── Source ──────────────────────────────────────���──────────────────────────
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'url' | 'ocr' | 'manual' | 'photo'
  url: text('url'),
  ocrRawText: text('ocr_raw_text'),
  siteName: text('site_name'),
  pageTitle: text('page_title'),
  thumbnailUrl: text('thumbnail_url'),
  capturedAt: text('captured_at'),
  createdAt: text('created_at').notNull(),
});

// ─── Recipe ────────────────���──────────────────────────────────────���─────────
export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    title: text('title').notNull(),
    titleReading: text('title_reading'),
    currentRevId: text('current_rev_id'),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    coverPhotoPath: text('cover_photo_path'), // 表紙写真（端末内パス, v7）
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyStatusIdx: index('idx_recipes_family_status').on(table.familyId, table.status),
    familyUpdatedIdx: index('idx_recipes_family_updated').on(table.familyId, table.updatedAt),
  }),
);

// ─── RecipeRevision ��────────────────────────────────────────────────────────
export const recipeRevisions = sqliteTable(
  'recipe_revisions',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    revisionNumber: integer('revision_number').notNull(),
    isMajor: integer('is_major', { mode: 'boolean' }).notNull().default(true),
    servings: integer('servings'),
    cookTimeMin: integer('cook_time_min'),
    prepTimeMin: integer('prep_time_min'),
    description: text('description'),
    authorNote: text('author_note'),
    sourceId: text('source_id').references(() => sources.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    recipeNumIdx: index('idx_revisions_recipe_num').on(table.recipeId, table.revisionNumber),
  }),
);

// ─── Ingredient ────────��────────────────────────────────────────────────────
export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    groupLabel: text('group_label'),
    name: text('name').notNull(),
    amount: text('amount'),
    note: text('note'),
  },
  (table) => ({
    revisionIdx: index('idx_ingredients_revision').on(table.revisionId),
  }),
);

// ─── Step ─────────────────���─────────────────────────────────���───────────────
export const steps = sqliteTable(
  'steps',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    body: text('body').notNull(),
    timerSec: integer('timer_sec'),
    photoId: text('photo_id'), // 将来のクラウド写真エンティティ用（未使用）
    photoPath: text('photo_path'), // 手順写真（端末内パス, v7）
  },
  (table) => ({
    revisionIdx: index('idx_steps_revision').on(table.revisionId),
  }),
);

// ─── Tag ──────────────────��────────────────────────────��────────────────────
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    familyNameIdx: uniqueIndex('idx_tags_family_name').on(table.familyId, table.name),
  }),
);

// ─── RecipeTag (join table) ──────────���──────────────────────────────────────
export const recipeTags = sqliteTable(
  'recipe_tags',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    recipeIdx: index('idx_recipe_tags_recipe').on(table.recipeId),
    tagIdx: index('idx_recipe_tags_tag').on(table.tagId),
  }),
);

// ─── CookingLog ───────────────────────────────────────────────��─────────────
export const cookingLogs = sqliteTable(
  'cooking_logs',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    recipeId: text('recipe_id').references(() => recipes.id),
    revisionId: text('revision_id').references(() => recipeRevisions.id),
    cookedBy: text('cooked_by')
      .notNull()
      .references(() => users.id),
    cookedAt: text('cooked_at').notNull(),
    servings: integer('servings'),
    rating: integer('rating'),
    memo: text('memo'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    familyDateIdx: index('idx_cooking_logs_family_date').on(table.familyId, table.cookedAt),
    recipeDateIdx: index('idx_cooking_logs_recipe_date').on(table.recipeId, table.cookedAt),
  }),
);

// ─── CookingPhoto ─────────��──────────────────────────────────��──────────────
export const cookingPhotos = sqliteTable(
  'cooking_photos',
  {
    id: text('id').primaryKey(),
    logId: text('log_id')
      .notNull()
      .references(() => cookingLogs.id),
    localPath: text('local_path').notNull(),
    cloudUrl: text('cloud_url'),
    sortOrder: integer('sort_order').notNull(),
    takenAt: text('taken_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    logIdx: index('idx_cooking_photos_log').on(table.logId),
  }),
);

// ─── Memo ───────────────���───────────────────────────────────────────────────
export const memos = sqliteTable(
  'memos',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    recipeIdx: index('idx_memos_recipe').on(table.recipeId),
  }),
);

// ─── SyncMeta ──────────────────��─────────────────────────────────���──────────
export const syncMeta = sqliteTable('sync_meta', {
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  vectorClock: text('vector_clock').notNull(), // JSON string
  deletedAt: text('deleted_at'),
  lastSyncedAt: text('last_synced_at'),
});

// ─── AppMeta ────────────────────────────────────────────────────────────────
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FTS5 Virtual Table ────���────────────────────────────────────────────────
// Note: Drizzle ORM does not natively support FTS5. We define it via raw SQL
// in migrations/setup. This constant holds the CREATE statement for reference.
export const RECIPE_FTS_CREATE_SQL = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS recipe_fts USING fts5(
    recipe_id UNINDEXED,
    title,
    title_reading,
    ingredient_names,
    tokenize='unicode61'
  )
`;

// ─── Nutrition (future, defined for completeness) ──────────────���────────────
export const ingredientNutrition = sqliteTable('ingredient_nutrition', {
  id: text('id').primaryKey(),
  ingredientId: text('ingredient_id')
    .notNull()
    .references(() => ingredients.id)
    .unique(),
  caloriesKcal: real('calories_kcal'),
  proteinG: real('protein_g'),
  fatG: real('fat_g'),
  carbsG: real('carbs_g'),
  saltG: real('salt_g'),
  dataSource: text('data_source').notNull().default('manual'), // 'manual' | 'api' | 'estimated'
  updatedAt: text('updated_at').notNull(),
});

// ─── ShoppingItem（買い物リスト, P1）────────────────────────────────────────
// 集約買い物リスト。家族グループ単位。名前正規化キーで突合（docs/買い物リスト・在庫設計.md）。
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    amount: text('amount'),
    checked: integer('checked').notNull().default(0),
    source: text('source').notNull().default('manual'), // 'manual' | 'recipe' | 'low_stock' | 'receipt'
    recipeId: text('recipe_id').references(() => recipes.id),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    checkedAt: text('checked_at'),
  },
  (table) => ({
    familyCheckedIdx: index('idx_shopping_items_family_checked').on(table.familyId, table.checked),
  }),
);

// ─── PantryItem（在庫, P2）──────────────────────────────────────────────────
// 家の在庫。数量×単位は厳密管理（同一商品は合算）。包装品は jan_code で識別（P2b）。
export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    lowStockThreshold: real('low_stock_threshold'),
    janCode: text('jan_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyNameIdx: index('idx_pantry_items_family_name').on(table.familyId, table.nameNormalized),
  }),
);

// ─── JanCatalog（JAN→商品名の記憶, P2b）─────────────────────────────────────
// バーコード(JAN)→名前/単位 のローカル辞書。初回入力で記憶し、次回スキャンで自動補完。
export const janCatalog = sqliteTable(
  'jan_catalog',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    janCode: text('jan_code').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyJanIdx: uniqueIndex('idx_jan_catalog_family_jan').on(table.familyId, table.janCode),
  }),
);

// ─── NameAlias（AI名寄せキャッシュ, name-matching）─────────────────────────────
// 正規化名 → 正規食材名（canonical）のキャッシュ。AI で一度解決して記憶し、以降の
// 在庫⇄レシピ突合に使う。辞書はソースに持たず、ここ（データ）に蓄積する。
export const nameAliases = sqliteTable(
  'name_aliases',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    sourceNormalized: text('source_normalized').notNull(),
    canonical: text('canonical').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familySourceIdx: uniqueIndex('idx_name_aliases_family_source').on(
      table.familyId,
      table.sourceNormalized,
    ),
  }),
);

// ══════════════════════════════════════════════════════════════════════════
// さいえん手帳（WBS 1.3）
//
// だいどこのテーブルとは当面併存する。UI が recipes 系を参照しているため、
// WBS 1.5（栽培 CRUD）で差し替えるまで両方が存在する。詳細は docs/データ設計.md
// タイムスタンプは既存テーブルに合わせて TEXT（ISO 8601）で統一する。
// ══════════════════════════════════════════════════════════════════════════

// ─── Crop（作物マスター）────────────────────────────────────────────────
// データ投入は WBS 3.1（30 作物）。ここでは器だけ用意する。
export const crops = sqliteTable('crops', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameReading: text('name_reading'),
  // 科（ナス科・ウリ科）。R17 連作障害チェックの判定キー
  family: text('family'),
  defaultUnit: text('default_unit'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── CropCalendar（栽培暦: 作物 × 地域帯の適期）──────────────────────────
export const cropCalendars = sqliteTable(
  'crop_calendars',
  {
    id: text('id').primaryKey(),
    cropId: text('crop_id')
      .notNull()
      .references(() => crops.id),
    // cold=寒冷地 / temperate=中間地 / warm=暖地
    region: text('region').notNull(),
    // sow=種まき / plant=植え付け / harvest=収穫
    kind: text('kind').notNull(),
    // 1〜12。年またぎは start > end で表す（例: 10月〜翌2月 = 10, 2）
    startMonth: integer('start_month').notNull(),
    endMonth: integer('end_month').notNull(),
  },
  (table) => ({
    // startMonth まで含める。同じ kind でも春秋 2 つの窓を持つ作物がある
    // （例: ジャガイモの春植え・秋植え）。v10 で 3 列の旧インデックスから移行
    cropRegionKindIdx: uniqueIndex('idx_crop_calendars_crop_region_kind_start').on(
      table.cropId,
      table.region,
      table.kind,
      table.startMonth,
    ),
  }),
);

// ─── CropGuide（作物ガイド）──────────────────────────────────────────────
export const cropGuides = sqliteTable('crop_guides', {
  cropId: text('crop_id')
    .primaryKey()
    .references(() => crops.id),
  spacingCm: integer('spacing_cm'),
  // full=日なた / partial=半日陰 / shade=日陰
  sunlight: text('sunlight'),
  wateringNote: text('watering_note'),
  // R10「次の作業」の判定に使う経過日数
  fertilizeAfterDays: integer('fertilize_after_days'),
  harvestAfterDays: integer('harvest_after_days'),
  // JSON 配列
  commonPests: text('common_pests'),
  tips: text('tips'),
});

// ─── Place（場所・区画）──────────────────────────────────────────────────
export const places = sqliteTable(
  'places',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    // planter=プランター / row=畝 / plot=区画 / other
    kind: text('kind'),
    note: text('note'),
    sortOrder: integer('sort_order'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyIdx: index('idx_places_family').on(table.familyId),
  }),
);

// ─── Planting（栽培）─────────────────────────────────────────────────────
// R01 の中核。だいどこの recipes に相当するが版管理は持たない。
export const plantings = sqliteTable(
  'plantings',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    // マスターにない作物も登録できるよう nullable
    cropId: text('crop_id').references(() => crops.id),
    // 表示名。マスター参照時もコピーを持つ — マスターの名称変更で
    // 過去の栽培記録の表示が変わらないようにするため
    cropName: text('crop_name').notNull(),
    cropNameReading: text('crop_name_reading'),
    variety: text('variety'),
    placeId: text('place_id').references(() => places.id),
    plantedOn: text('planted_on').notNull(),
    // seed=種 / seedling=苗
    plantedAs: text('planted_as').notNull(),
    coverPhotoPath: text('cover_photo_path'),
    note: text('note'),
    // NULL = 栽培中
    endedAt: text('ended_at'),
    // harvested=収穫完了 / died=枯死 / other
    endedReason: text('ended_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyEndedIdx: index('idx_plantings_family_ended').on(table.familyId, table.endedAt),
    placeIdx: index('idx_plantings_place').on(table.placeId),
    cropIdx: index('idx_plantings_crop').on(table.cropId),
  }),
);

// ─── PlantingTag（栽培 ↔ タグ）───────────────────────────────────────────
export const plantingTags = sqliteTable(
  'planting_tags',
  {
    plantingId: text('planting_id')
      .notNull()
      .references(() => plantings.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    pk: uniqueIndex('idx_planting_tags_pk').on(table.plantingId, table.tagId),
    tagIdx: index('idx_planting_tags_tag').on(table.tagId),
  }),
);

// ─── CareLog（作業ログ）──────────────────────────────────────────────────
// R04。収穫は含めない（harvests へ分離）。
export const careLogs = sqliteTable(
  'care_logs',
  {
    id: text('id').primaryKey(),
    plantingId: text('planting_id')
      .notNull()
      .references(() => plantings.id),
    // water=水やり / fertilize=追肥 / transplant=植え替え /
    // prune=剪定 / pest=防除 / other
    kind: text('kind').notNull(),
    loggedAt: text('logged_at').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    plantingDateIdx: index('idx_care_logs_planting_date').on(table.plantingId, table.loggedAt),
    dateIdx: index('idx_care_logs_date').on(table.loggedAt),
  }),
);

// ─── Harvest（収穫記録）──────────────────────────────────────────────────
// R06。数量・単位を持ち、R07 アルバムと R18 統計の対象になるため care_logs から分離。
export const harvests = sqliteTable(
  'harvests',
  {
    id: text('id').primaryKey(),
    plantingId: text('planting_id')
      .notNull()
      .references(() => plantings.id),
    harvestedAt: text('harvested_at').notNull(),
    // 任意入力（R06 の受け入れ基準）。写真だけでも成立する
    quantity: real('quantity'),
    // piece=個 / g / kg / bunch=束 / plant=株
    unit: text('unit'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    plantingDateIdx: index('idx_harvests_planting_date').on(table.plantingId, table.harvestedAt),
    dateIdx: index('idx_harvests_date').on(table.harvestedAt),
  }),
);

// ─── Photo（写真）────────────────────────────────────────────────────────
// 作業ログ・収穫・栽培のいずれにも付くポリモーフィック参照。
// 分けるとギャラリー（R05/R07）が 3 テーブルの UNION になるため 1 つにまとめる。
// FK 制約は張れないので、削除時のカスケードはアプリ側で行う。
export const photos = sqliteTable(
  'photos',
  {
    id: text('id').primaryKey(),
    // care_log / harvest / planting
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    localPath: text('local_path').notNull(),
    width: integer('width'),
    height: integer('height'),
    // 1 レコードあたり最大 6 枚（R04）
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_photos_owner').on(table.ownerType, table.ownerId),
  }),
);

// ─── Reminder（繰り返しリマインダー）─────────────────────────────────────
// R11。だいどこの単発通知を拡張する。繰り返しスケジュールは新規実装。
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    plantingId: text('planting_id')
      .notNull()
      .references(() => plantings.id),
    // care_logs.kind と同じ語彙
    kind: text('kind').notNull(),
    // daily / interval_days / weekly
    scheduleKind: text('schedule_kind').notNull(),
    intervalDays: integer('interval_days'),
    // weekly のとき使う。0=日曜のカンマ区切り
    weekdays: text('weekdays'),
    hour: integer('hour').notNull(),
    minute: integer('minute').notNull(),
    enabled: integer('enabled').notNull(),
    lastFiredAt: text('last_fired_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    plantingIdx: index('idx_reminders_planting').on(table.plantingId),
  }),
);

// ─── Material（資材在庫）─────────────────────────────────────────────────
// R12。だいどこの pantry_items に相当。
export const materials = sqliteTable(
  'materials',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    // seed=種 / fertilizer=肥料 / pesticide=薬剤 / soil=土 / tool=道具 / other
    category: text('category').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    // 閾値割れで通知（R12）
    lowThreshold: real('low_threshold'),
    janCode: text('jan_code'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyCategoryIdx: index('idx_materials_family_category').on(table.familyId, table.category),
  }),
);

// ─── GardenShoppingItem（買い物リスト）───────────────────────────────────
// R12。だいどこの shopping_items とは別テーブルにしている。
// 同じ表に載せると、タブから外しただけで残っている食材の買い物リストと
// 混ざり、菜園の買い物メモに「牛乳」が並ぶ。
export const gardenShoppingItems = sqliteTable(
  'garden_shopping_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    // 「2袋」「5m」など。自由入力（買い物メモは数量をきっちり書かないことが多い）
    amount: text('amount'),
    checked: integer('checked').notNull().default(0),
    // manual=手で追加 / low=残りわずかから追加
    source: text('source').notNull().default('manual'),
    // 資材から追加したものだけ。買ったときに在庫へ足し戻す先
    materialId: text('material_id').references(() => materials.id),
    createdAt: text('created_at').notNull(),
    // 「最初にチェックした時刻」= 在庫へ足した目印。外しても消さない
    checkedAt: text('checked_at'),
  },
  (table) => ({
    familyCheckedIdx: index('idx_garden_shopping_family_checked').on(table.familyId, table.checked),
  }),
);

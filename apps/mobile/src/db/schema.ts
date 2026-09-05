/**
 * SQLite schema — さいえん手帳
 *
 * だいどこからの fork 移植。レシピ・食材在庫・買い物・調理記録などの
 * だいどこ専用テーブルは WBS 2.9（a〜e）で画面・サービス・テーブルの順に
 * 削除した（WBS 2.9e で DROP。docs/WBS.md §2.9）。
 * だいどこから引き継いで恒久的に使うのは User / Family / FamilyMember / Tag /
 * SyncMeta / AppMeta のみ（tags は栽培のタグ付けに流用。R19 のグループ共有まで
 * families 構造をそのまま使う）。
 */
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

// ─── Tag（栽培のタグ付け）──────────────────────────────────────────────
// だいどこから流用。中間テーブルは planting_tags のみ新設（recipe_tags は
// レシピ削除と一緒に WBS 2.9e で DROP）。
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

// ─── SyncMeta / AppMeta（内部メタ）──────────────────────────────────────
export const syncMeta = sqliteTable('sync_meta', {
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  vectorClock: text('vector_clock').notNull(), // JSON string
  deletedAt: text('deleted_at'),
  lastSyncedAt: text('last_synced_at'),
});

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ══════════════════════════════════════════════════════════════════════════
// さいえん手帳（WBS 1.3〜）
//
// だいどこの recipes 系テーブルは WBS 2.9e で削除済み。詳細は docs/データ設計.md
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
  // 分類（leaf/root/fruit/bean/tuber/allium/herb/tree）。ガイド一覧のセクションと検索の絞り込み。
  // マスター作物だけが持つ。利用者が作った作物は null（WBS 4.19）
  category: text('category'),
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
  // 多年草（perennial=1）は null — 「翌年から」なので日数を持たない（WBS 4.19）
  harvestAfterDays: integer('harvest_after_days'),
  // JSON 配列
  commonPests: text('common_pests'),
  tips: text('tips'),
  // ─── WBS 4.19 で足した列（v14）。既存端末は ADD COLUMN で null から始まり、
  //     syncCropMaster が CROP_MASTER_VERSION の差分で埋める ───
  // 水やりの目安間隔（日）。R26 ケアスケジュールの既定値
  wateringIntervalDays: integer('watering_interval_days'),
  // 発芽までの日数
  germinationDays: integer('germination_days'),
  // 種まきから定植までの日数（苗物だけ）。R33 の材料
  transplantAfterDays: integer('transplant_after_days'),
  // 2 回目以降の追肥間隔（日）
  fertilizeIntervalDays: integer('fertilize_interval_days'),
  // 収穫の幅（最短・最長）。進行帯の「窓」
  harvestWindowMinDays: integer('harvest_window_min_days'),
  harvestWindowMaxDays: integer('harvest_window_max_days'),
  // 初収穫から採り続けられる日数
  harvestDurationDays: integer('harvest_duration_days'),
  // 発芽適温・生育適温（℃）
  tempGerminationMin: integer('temp_germination_min'),
  tempGerminationMax: integer('temp_germination_max'),
  tempGrowthMin: integer('temp_growth_min'),
  tempGrowthMax: integer('temp_growth_max'),
  // 連作を避ける年数。R17
  rotationYears: integer('rotation_years'),
  // 作物ごとの作業（摘芯・支柱・土寄せ…）。JSON 配列 [{kind, afterDays, note?}]
  tasks: text('tasks'),
  // 1=多年草
  perennial: integer('perennial'),
  // 出典なしの編集者判断（一覧の絞り込みと登録時の助言にだけ使う）
  beginner: integer('beginner'),
  containerOk: integer('container_ok'),
  containerDepthCm: integer('container_depth_cm'),
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

// ─── HarvestPhotoRead（収穫写真の読み取り）───────────────────────────────
// 「写真から記録」（#143）のワークフロー状態。収穫 1 件につき最大 1 行。
// 収穫のドメインデータ（quantity 等）とは分ける — こちらは読み取りの進行状態で、
// 適用（applied）か却下（dismissed）で役目を終える。
//
// state の遷移:
//   pending →(読み取り成功)→ analyzed →(記録する)→ applied
//                                      →(しない)→ dismissed
//          →(3 回失敗)→ failed
//   編集画面で数量を入れて保存 → 読み取った数と同じなら applied（編集画面は
//   結果を下書きとして入れて開くので、そのまま保存＝採用）、違えば dismissed
//
// paid = 「サーバーへ送ってよい」印。**これが立っているものだけが処理される**
// （無料枠の 1 枚か、リワード視聴完了で立つ。順序の不変条件 — #144）。
export const harvestPhotoReads = sqliteTable(
  'harvest_photo_reads',
  {
    harvestId: text('harvest_id')
      .primaryKey()
      .references(() => harvests.id),
    state: text('state').notNull().default('pending'),
    paid: integer('paid').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    cropGuess: text('crop_guess'),
    cropConfidence: text('crop_confidence'),
    count: integer('count'),
    countConfidence: text('count_confidence'),
    readNote: text('read_note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    stateIdx: index('idx_harvest_photo_reads_state').on(table.state),
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

-- DB v13 の CREATE_TABLES_SQL（059b92a^ = WBS 4.19 第 1 段の直前）。
-- **歴史のスナップショット。更新しないこと。**
--
-- schema-sql.test.ts が「v13 の端末に runMigrations を流すと、列名集合が
-- 新規インストールと一致する」を見るために使う。列を足したときに直すのは
-- migrate.ts の ADD_COLUMN_MIGRATIONS だけで、このファイルは触らない
-- （触ると『CREATE_TABLES_SQL にだけ足した』ドリフトを見逃す）。

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
    category TEXT,
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
    tips TEXT,
    watering_interval_days INTEGER,
    germination_days INTEGER,
    transplant_after_days INTEGER,
    fertilize_interval_days INTEGER,
    harvest_window_min_days INTEGER,
    harvest_window_max_days INTEGER,
    harvest_duration_days INTEGER,
    temp_germination_min INTEGER,
    temp_germination_max INTEGER,
    temp_growth_min INTEGER,
    temp_growth_max INTEGER,
    rotation_years INTEGER,
    tasks TEXT,
    perennial INTEGER,
    beginner INTEGER,
    container_ok INTEGER,
    container_depth_cm INTEGER
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

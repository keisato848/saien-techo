/**
 * バックアップ・復元（R13 / WBS 2.8）。
 *
 * いちばん大事なのは「**新しく足したテーブルが漏れていないか**」。
 * だいどこから移植した直後、対象テーブルがレシピと調理記録のままだったため、
 * バックアップを取っても栽培・作業ログ・収穫・写真が 1 件も残らなかった。
 * ここでは実 SQLite のテーブル一覧と突き合わせて、漏れをテストで止める。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

import {
  BACKUP_EXCLUDED_TABLES,
  BACKUP_TABLE_NAMES,
  createBackupPayloadFromDatabase,
  createMigrationPhotoArchivePath,
  formatBackupFileName,
  formatMigrationBackupFileName,
  parseLocalBackupPayload,
  parseMigrationBackupManifest,
  pickLatestBackup,
  replaceDatabase,
  shouldCreateAutoBackup,
  type BackupFileSummary,
} from '../backup.service';

const emptyTables = Object.fromEntries(BACKUP_TABLE_NAMES.map((name) => [name, []]));

function payloadJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'saien.local-backup',
    schemaVersion: 2,
    exportedAt: '2026-08-06T00:00:00.000Z',
    tables: emptyTables,
    ...overrides,
  });
}

/**
 * WBS 2.9e より前、だいどこのテーブル（recipes・cooking_logs ほか）も
 * 一緒に入っていた実際の出力に近い形。schemaVersion 1 のまま。
 * 「知らないテーブルは読み飛ばして残りを復元できる」を確かめるためのもの
 */
function legacyPayloadJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'saien.local-backup',
    schemaVersion: 1,
    exportedAt: '2026-08-06T00:00:00.000Z',
    tables: {
      ...emptyTables,
      recipes: [
        {
          id: 'recipe-1',
          family_id: 'family-001',
          title: '肉じゃが',
          title_reading: null,
          current_rev_id: null,
          status: 'active',
          created_by: 'user-kei',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      cooking_logs: [
        {
          id: 'log-1',
          family_id: 'family-001',
          recipe_id: 'recipe-1',
          revision_id: null,
          cooked_by: 'user-kei',
          cooked_at: '2026-01-02T00:00:00.000Z',
          servings: null,
          rating: null,
          memo: null,
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
    },
    ...overrides,
  });
}

describe('ファイル名', () => {
  it('端末ローカルの日時で名前を作る', () => {
    const date = new Date(2026, 7, 6, 7, 8, 9);
    expect(formatBackupFileName(date)).toBe('saien-backup-20260806-070809.json');
  });

  it('移行ファイルも同じ組み立て', () => {
    const date = new Date(2026, 7, 6, 7, 8, 9);
    expect(formatMigrationBackupFileName(date)).toBe('saien-transfer-20260806-070809.saien.zip');
  });

  it('だいどこの名前は使わない', () => {
    expect(formatBackupFileName()).not.toMatch(/daidoko/);
    expect(formatMigrationBackupFileName()).not.toMatch(/daidoko/);
  });
});

describe('parseLocalBackupPayload', () => {
  it('正しい中身は読める', () => {
    const payload = parseLocalBackupPayload(payloadJson());

    expect(payload.format).toBe('saien.local-backup');
    expect(payload.schemaVersion).toBe(2);
  });

  it('知らない形式は受け取らない', () => {
    expect(() => parseLocalBackupPayload(payloadJson({ schemaVersion: 999 }))).toThrow(
      '対応していないバックアップ形式です',
    );
  });

  it('だいどこのバックアップは読み込まない（中身の作りが違う）', () => {
    expect(() => parseLocalBackupPayload(payloadJson({ format: 'daidoko.local-backup' }))).toThrow(
      '対応していないバックアップ形式です',
    );
  });

  it('テーブルが欠けていたら弾く', () => {
    expect(() =>
      parseLocalBackupPayload(payloadJson({ tables: { ...emptyTables, plantings: undefined } })),
    ).toThrow(/plantings/);
  });

  it('旧形式（v1・だいどこのテーブル入り）も読める。知らないテーブルは読み飛ばす', () => {
    const payload = parseLocalBackupPayload(legacyPayloadJson());

    expect(payload.schemaVersion).toBe(1);
    // 今の BACKUP_TABLES に無いテーブルは、読み込み結果に残らない
    expect((payload.tables as Record<string, unknown>).recipes).toBeUndefined();
    expect((payload.tables as Record<string, unknown>).cooking_logs).toBeUndefined();
    // 今も使うテーブルは変わらず読める
    expect(payload.tables.users).toEqual([]);
    expect(payload.tables.plantings).toEqual([]);
  });
});

describe('移行ファイル', () => {
  function manifestJson(archivePath: string): string {
    return JSON.stringify({
      format: 'saien.migration-backup',
      schemaVersion: 2,
      exportedAt: '2026-08-06T00:00:00.000Z',
      backup: JSON.parse(payloadJson()),
      photos: [
        {
          id: 'photos:photo-1',
          archivePath,
          fileName: 'photo-1.jpg',
          originalLocalPath: 'file:///old/photo-1.jpg',
        },
      ],
    });
  }

  it('写真の並びごと読める', () => {
    const manifest = parseMigrationBackupManifest(manifestJson('backup-photos/photo-1.jpg'));

    expect(manifest.format).toBe('saien.migration-backup');
    expect(manifest.photos[0]?.archivePath).toBe('backup-photos/photo-1.jpg');
  });

  it('アーカイブの外を指すパスは弾く（zip 展開で外に書かせない）', () => {
    expect(() => parseMigrationBackupManifest(manifestJson('../photo-1.jpg'))).toThrow(
      '写真バックアップのパスが不正です',
    );
  });

  it('テーブルをまたいでも衝突しない鍵で保存先を決める', () => {
    expect(createMigrationPhotoArchivePath('photos:photo-1', 'file:///tmp/収穫 写真.jpg')).toMatch(
      /^backup-photos\/photos_photo-1-/,
    );
    expect(createMigrationPhotoArchivePath('photos:x', 'file:///a.jpg')).not.toBe(
      createMigrationPhotoArchivePath('plantings:x', 'file:///a.jpg'),
    );
  });

  it('旧形式（v1）の移行ファイルも読める（cooking_photos 鍵を含んでいても壊れない）', () => {
    const legacyManifest = JSON.stringify({
      format: 'saien.migration-backup',
      schemaVersion: 1,
      exportedAt: '2026-08-06T00:00:00.000Z',
      backup: JSON.parse(legacyPayloadJson()),
      photos: [
        {
          id: 'photos:photo-1',
          archivePath: 'backup-photos/photo-1.jpg',
          fileName: 'photo-1.jpg',
          originalLocalPath: 'file:///old/photo-1.jpg',
        },
        {
          // WBS 2.9e で消えた だいどこの調理写真テーブル。パース自体は通り、
          // 復元時（restoreMigrationBackupPackage）に読み飛ばされる
          id: 'cooking_photos:old-1',
          archivePath: 'backup-photos/old-1.jpg',
          fileName: 'old-1.jpg',
          originalLocalPath: 'file:///old/old-1.jpg',
        },
      ],
    });

    const manifest = parseMigrationBackupManifest(legacyManifest);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.backup.schemaVersion).toBe(1);
    expect(manifest.photos.map((photo) => photo.id)).toEqual([
      'photos:photo-1',
      'cooking_photos:old-1',
    ]);
  });
});

describe('pickLatestBackup', () => {
  it('いちばん新しいものを選ぶ', () => {
    const backups: BackupFileSummary[] = [
      {
        uri: 'file:///backups/old.json',
        fileName: 'saien-backup-20260806-070000.json',
        exportedAt: null,
        sizeBytes: 1,
        modifiedAt: 100,
      },
      {
        uri: 'file:///backups/new.json',
        fileName: 'saien-backup-20260806-080000.json',
        exportedAt: null,
        sizeBytes: 1,
        modifiedAt: 200,
      },
    ];

    expect(pickLatestBackup(backups)?.uri).toBe('file:///backups/new.json');
  });

  it('1 件も無ければ null', () => {
    expect(pickLatestBackup([])).toBeNull();
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('バックアップ対象（実 SQLite）', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
  });

  afterEach(() => mockHandles.close());

  /** FTS の仮想テーブルと、その影テーブルは対象外 */
  function realTableNames(): string[] {
    const rows = mockHandles.expoDb.getAllSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    return rows
      .map((row) => row.name)
      .filter((name) => !name.includes('_fts'))
      .sort();
  }

  it('DB のテーブルはすべてバックアップに含まれる（足し忘れを止める）', () => {
    const missing = realTableNames().filter(
      (name) => !BACKUP_TABLE_NAMES.includes(name) && !BACKUP_EXCLUDED_TABLES.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('外すテーブルは「わざと外した」一覧に載っている', () => {
    // 一覧に書いたものが実在しなくなったら、消し忘れとして気づけるように
    const real = realTableNames();
    expect(BACKUP_EXCLUDED_TABLES.filter((name) => !real.includes(name))).toEqual([]);
  });

  it('存在しないテーブルを対象にしていない', () => {
    const real = realTableNames();
    const unknown = BACKUP_TABLE_NAMES.filter((name) => !real.includes(name));
    expect(unknown).toEqual([]);
  });

  it('栽培まわりのテーブルが対象に入っている', () => {
    for (const name of [
      'places',
      'plantings',
      'planting_tags',
      'care_logs',
      'harvests',
      'photos',
      'reminders',
      'materials',
      'garden_shopping_items',
    ]) {
      expect(BACKUP_TABLE_NAMES).toContain(name);
    }
  });
});

describeIfSqlite('取って戻す（実 SQLite）', () => {
  const NOW = '2026-08-06T00:00:00.000Z';

  function seedGarden(): void {
    const run = (sql: string, params: unknown[] = []) => mockHandles.expoDb.runSync(sql, params);

    run('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'user-kei',
      'テスト',
      NOW,
      NOW,
    ]);
    run(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['family-001', 'テスト農園', 'user-kei', 'TEST01', NOW, NOW],
    );
    run(
      'INSERT INTO places (id, family_id, name, kind, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['place-1', 'family-001', '南の畝', 'row', 1, NOW, NOW],
    );
    run(
      'INSERT INTO plantings (id, family_id, crop_name, place_id, planted_on, planted_as, cover_photo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'planting-1',
        'family-001',
        'トマト',
        'place-1',
        '2026-05-01',
        'seedling',
        'file:///photos/cover.jpg',
        NOW,
        NOW,
      ],
    );
    run(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['care-1', 'planting-1', 'water', NOW, '朝に水やり', NOW, NOW],
    );
    run(
      'INSERT INTO harvests (id, planting_id, harvested_at, quantity, unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['harvest-1', 'planting-1', NOW, 5, '個', NOW, NOW],
    );
    run(
      'INSERT INTO photos (id, owner_type, owner_id, local_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['photo-1', 'harvest', 'harvest-1', 'file:///photos/harvest-1.jpg', 0, NOW],
    );
    run(
      'INSERT INTO reminders (id, planting_id, kind, schedule_kind, hour, minute, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['reminder-1', 'planting-1', 'water', 'daily', 7, 0, 1, NOW, NOW],
    );
    run(
      'INSERT INTO materials (id, family_id, name, category, quantity, unit, low_threshold, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['material-1', 'family-001', '化成肥料', 'fertilizer', 1.5, 'kg', 0.5, NOW, NOW],
    );
    run(
      'INSERT INTO garden_shopping_items (id, family_id, name, name_normalized, checked, source, material_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['shop-1', 'family-001', '支柱', 'しちゅう', 0, 'manual', null, NOW],
    );
  }

  function countOf(table: string): number {
    return mockHandles.expoDb.getAllSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
  }

  beforeEach(() => {
    mockHandles = createTestDb();
    seedGarden();
  });

  afterEach(() => mockHandles.close());

  it('栽培の記録がバックアップに載る', () => {
    const payload = createBackupPayloadFromDatabase();

    expect(payload.tables.plantings).toHaveLength(1);
    expect(payload.tables.care_logs).toHaveLength(1);
    expect(payload.tables.harvests).toHaveLength(1);
    expect(payload.tables.photos).toHaveLength(1);
    expect(payload.tables.reminders).toHaveLength(1);
    expect(payload.tables.materials).toHaveLength(1);
    expect(payload.tables.garden_shopping_items).toHaveLength(1);
  });

  it('消してから戻すと、栽培の記録が元どおりになる', () => {
    const payload = createBackupPayloadFromDatabase();

    mockHandles.expoDb.execSync('PRAGMA foreign_keys = OFF');
    for (const table of [
      'garden_shopping_items',
      'materials',
      'reminders',
      'photos',
      'harvests',
      'care_logs',
      'plantings',
      'places',
    ]) {
      mockHandles.expoDb.execSync(`DELETE FROM ${table}`);
    }
    mockHandles.expoDb.execSync('PRAGMA foreign_keys = ON');
    expect(countOf('plantings')).toBe(0);

    replaceDatabase(payload);

    expect(countOf('places')).toBe(1);
    expect(countOf('plantings')).toBe(1);
    expect(countOf('care_logs')).toBe(1);
    expect(countOf('harvests')).toBe(1);
    expect(countOf('photos')).toBe(1);
    expect(countOf('reminders')).toBe(1);
    expect(countOf('materials')).toBe(1);
    expect(countOf('garden_shopping_items')).toBe(1);
  });

  it('中身まで戻る（列の取りこぼしが無い）', () => {
    const payload = createBackupPayloadFromDatabase();
    replaceDatabase(payload);

    const [planting] =
      mockHandles.expoDb.getAllSync<Record<string, unknown>>('SELECT * FROM plantings');
    expect(planting.crop_name).toBe('トマト');
    expect(planting.place_id).toBe('place-1');
    expect(planting.planted_as).toBe('seedling');
    expect(planting.cover_photo_path).toBe('file:///photos/cover.jpg');

    const [harvest] =
      mockHandles.expoDb.getAllSync<Record<string, unknown>>('SELECT * FROM harvests');
    expect(harvest.quantity).toBe(5);
    expect(harvest.unit).toBe('個');

    const [material] =
      mockHandles.expoDb.getAllSync<Record<string, unknown>>('SELECT * FROM materials');
    expect(material.low_threshold).toBe(0.5);
  });

  it('復元を 2 回続けても増えない', () => {
    const payload = createBackupPayloadFromDatabase();

    replaceDatabase(payload);
    replaceDatabase(payload);

    expect(countOf('plantings')).toBe(1);
    expect(countOf('care_logs')).toBe(1);
  });

  it('外部キーの向きどおりに戻せる（親より先に子を入れない）', () => {
    const payload = createBackupPayloadFromDatabase();
    // 参照される側（places・plantings）が先に入っていないと FK 違反で落ちる
    expect(() => replaceDatabase(payload)).not.toThrow();
  });

  it('JSON にしても読み戻せる（ファイル経由と同じ経路）', () => {
    const payload = createBackupPayloadFromDatabase();
    const restored = parseLocalBackupPayload(JSON.stringify(payload));

    expect(restored.tables.plantings).toHaveLength(1);
    expect(restored.tables.materials[0].name).toBe('化成肥料');
  });

  it('旧形式（v1・だいどこのテーブル入り）のバックアップからも戻せる', () => {
    const payload = createBackupPayloadFromDatabase();
    // WBS 2.9e より前は、こういうだいどこのテーブルも一緒に入っていた。
    // 実際の旧バックアップファイルに近い形にするため、そのまま JSON へ混ぜる
    const legacyJson = JSON.stringify({
      format: 'saien.local-backup',
      schemaVersion: 1,
      exportedAt: payload.exportedAt,
      tables: {
        ...payload.tables,
        recipes: [
          {
            id: 'recipe-1',
            family_id: 'family-001',
            title: '肉じゃが',
            title_reading: null,
            current_rev_id: null,
            status: 'active',
            created_by: 'user-kei',
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    });

    mockHandles.expoDb.execSync('PRAGMA foreign_keys = OFF');
    for (const table of [
      'garden_shopping_items',
      'materials',
      'reminders',
      'photos',
      'harvests',
      'care_logs',
      'plantings',
      'places',
    ]) {
      mockHandles.expoDb.execSync(`DELETE FROM ${table}`);
    }
    mockHandles.expoDb.execSync('PRAGMA foreign_keys = ON');
    expect(countOf('plantings')).toBe(0);

    const restored = parseLocalBackupPayload(legacyJson);
    expect(restored.schemaVersion).toBe(1);

    replaceDatabase(restored);

    expect(countOf('places')).toBe(1);
    expect(countOf('plantings')).toBe(1);
    expect(countOf('care_logs')).toBe(1);
    expect(countOf('harvests')).toBe(1);
    expect(countOf('materials')).toBe(1);
    expect(countOf('garden_shopping_items')).toBe(1);
  });
});

describe('shouldCreateAutoBackup', () => {
  function summary(exportedAt: string | null): BackupFileSummary {
    return {
      uri: 'file:///backups/x.json',
      fileName: 'saien-backup-20260806-070000.json',
      exportedAt,
      sizeBytes: 1,
      modifiedAt: 0,
    };
  }

  const now = new Date(2026, 7, 14, 12);

  it('1 度も取っていなければ取る', () => {
    expect(shouldCreateAutoBackup(null, now)).toBe(true);
  });

  it('前回から 7 日たっていれば取る', () => {
    expect(shouldCreateAutoBackup(summary(new Date(2026, 7, 7, 12).toISOString()), now)).toBe(true);
  });

  it('ちょうど 7 日目に取る（毎週が 8 日おきにならない）', () => {
    const exactly = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    expect(shouldCreateAutoBackup(summary(exactly), now)).toBe(true);
  });

  it('まだ 7 日たっていなければ取らない', () => {
    expect(shouldCreateAutoBackup(summary(new Date(2026, 7, 10, 12).toISOString()), now)).toBe(
      false,
    );
  });

  it('直後の再起動では取らない（起動のたびに増えない）', () => {
    expect(shouldCreateAutoBackup(summary(now.toISOString()), now)).toBe(false);
  });

  it('日時が読めないものは「無い」と同じ扱いにする', () => {
    expect(shouldCreateAutoBackup(summary(null), now)).toBe(true);
    expect(shouldCreateAutoBackup(summary('こわれた'), now)).toBe(true);
  });
});

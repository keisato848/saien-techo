import {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  type SeedSnapshot,
  shouldInstallSampleData,
} from '../migrate';
import { seedCareLogs, seedPlantings, seedUsers } from '../seed';

function snapshot(overrides: Partial<SeedSnapshot> = {}): SeedSnapshot {
  return {
    userIds: [],
    familyIds: [],
    tagIds: [],
    placeIds: [],
    plantingIds: [],
    careLogIds: [],
    harvestIds: [],
    materialIds: [],
    ...overrides,
  };
}

describe('database migrations', () => {
  it('marks the SQLite schema version after table creation', () => {
    const statements: string[] = [];

    const result = runMigrations({
      execSync: (statement) => statements.push(statement),
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS plantings');
    expect(statements).toContain(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  });

  it('survives duplicate-column errors on re-run (ADD_COLUMN_MIGRATIONS が空でも動く)', () => {
    const statements: string[] = [];

    const result = runMigrations({
      execSync: (statement) => {
        statements.push(statement);
        // Simulate an already-migrated DB: any ALTER would fail as duplicate.
        if (statement.startsWith('ALTER TABLE')) {
          throw new Error('duplicate column name');
        }
      },
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(statements).toContain(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  });

  it('drops だいどこ由来のテーブル, bracketed by PRAGMA foreign_keys OFF/ON (WBS 2.9e)', () => {
    const statements: string[] = [];

    runMigrations({
      execSync: (statement) => statements.push(statement),
    });

    const offIndex = statements.indexOf('PRAGMA foreign_keys = OFF');
    const onIndex = statements.indexOf('PRAGMA foreign_keys = ON');
    const dropRecipesIndex = statements.indexOf('DROP TABLE IF EXISTS recipes');

    expect(offIndex).toBeGreaterThan(-1);
    expect(onIndex).toBeGreaterThan(offIndex);
    expect(dropRecipesIndex).toBeGreaterThan(offIndex);
    expect(dropRecipesIndex).toBeLessThan(onIndex);
    expect(statements).toContain('DROP TABLE IF EXISTS cooking_logs');
    expect(statements).toContain('DROP TABLE IF EXISTS recipe_fts');
  });
});

describe('sample data seed guard', () => {
  // WBS 2.9c で判定対象をだいどこ(レシピ・調理記録)から栽培側へ差し替えた

  it('installs sample data into an empty database', () => {
    expect(shouldInstallSampleData(snapshot())).toBe(true);
  });

  it('continues an interrupted seed when only known sample rows exist', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          plantingIds: [seedPlantings[0].id],
          careLogIds: [seedCareLogs[0].id],
        }),
      ),
    ).toBe(true);
  });

  it('does not install sample data over user-created plantings', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          plantingIds: [seedPlantings[0].id, 'planting-user-created'],
        }),
      ),
    ).toBe(false);
  });

  it('does not install sample data over user-created care logs', () => {
    expect(
      shouldInstallSampleData(
        snapshot({
          userIds: [seedUsers[0].id],
          careLogIds: [seedCareLogs[0].id, 'care-user-created'],
        }),
      ),
    ).toBe(false);
  });

  it('does not install sample data over user-created materials', () => {
    expect(shouldInstallSampleData(snapshot({ materialIds: ['material-user-created'] }))).toBe(
      false,
    );
  });
});

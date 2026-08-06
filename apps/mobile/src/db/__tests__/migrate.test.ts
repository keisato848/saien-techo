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

  it('adds v7 photo columns and survives duplicate-column errors on re-run', () => {
    const statements: string[] = [];

    const result = runMigrations({
      execSync: (statement) => {
        statements.push(statement);
        // Simulate an already-migrated DB: every ALTER fails as duplicate.
        if (statement.startsWith('ALTER TABLE')) {
          throw new Error('duplicate column name');
        }
      },
    });

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(statements).toContain(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
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

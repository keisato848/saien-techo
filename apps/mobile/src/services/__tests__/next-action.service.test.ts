/**
 * 「次の作業」を実 SQLite に対してテストする（R10 / WBS 3.4）。
 * ガイドの日数は 30 作物マスターそのもの（カブ: 追肥 20 日・収穫 45 日）。
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

import { syncCropMaster } from '../../db/migrate';
import {
  describeNextAction,
  getNextActions,
  getNextActionsForPlanting,
  snoozeNextAction,
} from '../next-action.service';

const FAMILY_ID = 'family-001';
const NOW = new Date(2026, 7, 8, 12); // 2026-08-08

function seedBase(): void {
  const now = NOW.toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
  );
}

/** daysAgo 日前に植えた栽培を作る */
function seedPlanting(id: string, cropId: string | null, cropName: string, daysAgo: number): void {
  const planted = new Date(NOW);
  planted.setDate(planted.getDate() - daysAgo);
  mockHandles.expoDb.runSync(
    'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      FAMILY_ID,
      cropId,
      cropName,
      planted.toISOString(),
      'seed',
      NOW.toISOString(),
      NOW.toISOString(),
    ],
  );
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('next-action.service (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  it('目安を過ぎたら追肥と収穫を提案する（カブ 50 日目 → 両方）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);

    const actions = await getNextActions(NOW);

    expect(actions).toEqual([
      expect.objectContaining({
        plantingId: 'p1',
        kind: 'harvest',
        elapsedDays: 50,
        thresholdDays: 45,
      }),
      expect.objectContaining({
        plantingId: 'p1',
        kind: 'fertilize',
        elapsedDays: 50,
        thresholdDays: 20,
      }),
    ]);
  });

  it('目安前は何も出さない（カブ 10 日目）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 10);
    expect(await getNextActions(NOW)).toEqual([]);
  });

  it('追肥済みなら追肥は出さない（2 回目以降はリマインダーの守備範囲）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 30);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'fertilize', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    expect(await getNextActions(NOW)).toEqual([]);
  });

  it('初収穫を記録したら収穫の提案は止まる', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    mockHandles.expoDb.runSync(
      'INSERT INTO harvests (id, planting_id, harvested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['h1', 'p1', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    const actions = await getNextActions(NOW);
    expect(actions.map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('追肥の目安が無い作物（エダマメ）は追肥を提案しない', async () => {
    seedPlanting('p1', 'crop-edamame', 'エダマメ', 30);
    expect(await getNextActions(NOW)).toEqual([]);
  });

  it('終了した栽培・ガイド無し栽培は対象外', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    mockHandles.expoDb.runSync("UPDATE plantings SET ended_at = ? WHERE id = 'p1'", [
      NOW.toISOString(),
    ]);
    seedPlanting('p2', null, '謎の野菜', 100);

    expect(await getNextActions(NOW)).toEqual([]);
  });

  it('「あとで」で 3 日間消え、4 日後に戻る', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 30);
    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['fertilize']);

    await snoozeNextAction('p1', 'fertilize', NOW);

    expect(await getNextActions(NOW)).toEqual([]);
    const in2days = new Date(NOW);
    in2days.setDate(in2days.getDate() + 2);
    expect(await getNextActions(in2days)).toEqual([]);

    const in4days = new Date(NOW);
    in4days.setDate(in4days.getDate() + 4);
    expect((await getNextActions(in4days)).map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('先送りは栽培×種類ごと（収穫を先送りしても追肥は残る）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    await snoozeNextAction('p1', 'harvest', NOW);

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('収穫が先・経過日数の多い順に並ぶ', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50); // harvest + fertilize
    seedPlanting('p2', 'crop-komatsuna', 'コマツナ', 40); // 収穫35・追肥15 → 両方
    const actions = await getNextActions(NOW);

    expect(actions.map((a) => `${a.plantingId}:${a.kind}`)).toEqual([
      'p1:harvest',
      'p2:harvest',
      'p1:fertilize',
      'p2:fertilize',
    ]);
  });

  it('栽培詳細用はその栽培の分だけ返す', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    seedPlanting('p2', 'crop-komatsuna', 'コマツナ', 40);

    const actions = await getNextActionsForPlanting('p2', NOW);
    expect(actions.every((a) => a.plantingId === 'p2')).toBe(true);
    expect(actions).toHaveLength(2);
  });
});

describe('describeNextAction', () => {
  it('R10 の受け入れ基準の文面', () => {
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'カブ',
        kind: 'fertilize',
        elapsedDays: 21,
        thresholdDays: 20,
      }),
    ).toBe('そろそろ追肥（植え付けから21日・目安 約20日）');
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'カブ',
        kind: 'harvest',
        elapsedDays: 50,
        thresholdDays: 45,
      }),
    ).toBe('収穫適期に入りました（目安 約45日・いま50日目）');
  });
});

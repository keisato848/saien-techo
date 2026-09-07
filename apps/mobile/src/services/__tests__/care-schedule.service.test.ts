/**
 * ケアスケジュール自動提案を実 SQLite に対してテストする（R26 / WBS 4.8）。
 *
 * 間隔は作物マスターそのもの
 * （ナス = 水やり毎日・追肥 15 日ごと（初回 15 日） /
 *  トマト = 水やり 3 日おき・追肥 20 日ごと /
 *  カブ = 水やり 2 日おき・追肥は 1 回きり（間隔なし））。
 * ここで固定したいのは「何を提案し、何を提案しないか」。
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

// OS への予約は端末でしか確かめられない。ここでは「作られたか」だけを見る
jest.mock('../notification.service', () => ({
  scheduleReminderNotification: () => Promise.resolve(true),
  cancelReminderNotifications: () => Promise.resolve(),
}));

import { syncCropMaster } from '../../db/migrate';
import {
  applyCareSchedule,
  buildFertilizeSuggestion,
  buildWateringSuggestion,
  describeCareSuggestion,
  suggestCareSchedule,
} from '../care-schedule.service';
import { createReminder, getReminders } from '../reminder.service';

const FAMILY_ID = 'family-001';
const NOW = new Date(2026, 4, 10, 9); // 2026-05-10

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

function seedPlanting(
  id: string,
  cropId: string | null,
  cropName: string,
  endedAt: string | null = null,
): void {
  const now = NOW.toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, FAMILY_ID, cropId, cropName, now, 'seedling', endedAt, now, now],
  );
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('care-schedule.service (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  it('水やり3日おきと追肥20日おきを提案する（トマト）', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト');

    const suggestions = await suggestCareSchedule('p1');

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      kind: 'water',
      scheduleKind: 'interval_days',
      intervalDays: 3,
      hour: 7,
    });
    expect(suggestions[1]).toMatchObject({
      kind: 'fertilize',
      scheduleKind: 'interval_days',
      intervalDays: 20,
      hour: 9,
    });
    // 同じ時刻に 2 つ鳴らさない
    expect(suggestions[0].hour).not.toBe(suggestions[1].hour);
  });

  it('毎日の水やりは interval_days ではなく daily にする（ナス）', async () => {
    seedPlanting('p1', 'crop-nasu', 'ナス');

    const [watering] = await suggestCareSchedule('p1');

    expect(watering).toMatchObject({ kind: 'water', scheduleKind: 'daily', intervalDays: null });
    expect(describeCareSuggestion(watering)).toBe('毎日 7:00');
  });

  it('追肥が1回きりの作物には追肥を提案しない（カブ）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ');

    const suggestions = await suggestCareSchedule('p1');

    expect(suggestions.map((s) => s.kind)).toEqual(['water']);
  });

  it('すでにお知らせがある栽培には提案しない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト');
    await createReminder({
      plantingId: 'p1',
      kind: 'water',
      scheduleKind: 'daily',
      hour: 6,
      minute: 30,
    });

    expect(await suggestCareSchedule('p1')).toEqual([]);
  });

  it('マスターに無い作物（自由入力）には提案しない', async () => {
    seedPlanting('p1', null, 'アーティチョーク');

    expect(await suggestCareSchedule('p1')).toEqual([]);
  });

  it('終わった栽培には提案しない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', NOW.toISOString());

    expect(await suggestCareSchedule('p1')).toEqual([]);
  });

  it('選んだ提案だけをお知らせとして作る', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト');
    const suggestions = await suggestCareSchedule('p1');

    const created = await applyCareSchedule('p1', [suggestions[1]]);

    expect(created).toHaveLength(1);
    const reminders = await getReminders('p1');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: 'fertilize',
      scheduleKind: 'interval_days',
      intervalDays: 20,
      hour: 9,
      minute: 0,
      enabled: true,
    });
  });

  it('何も選ばなければお知らせは作られない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト');

    expect(await applyCareSchedule('p1', [])).toEqual([]);
    expect(await getReminders('p1')).toEqual([]);
  });
});

describe('提案の組み立て（純関数）', () => {
  it('水やり間隔が無い作物は提案しない（雨まかせ）', () => {
    expect(buildWateringSuggestion(null, '雨まかせでよい。')).toBeNull();
  });

  it('水やりの理由にはガイドの一言をそのまま使う', () => {
    const suggestion = buildWateringSuggestion(3, '乾かし気味に育てると甘くなる。');
    if (!suggestion) throw new Error('提案が組み立てられていません');

    expect(suggestion.reason).toBe('乾かし気味に育てると甘くなる。');
    expect(describeCareSuggestion(suggestion)).toBe('3日おき 7:00');
  });

  it('ガイドに一言が無ければ間隔から理由を作る', () => {
    expect(buildWateringSuggestion(2, null)?.reason).toBe('2日おきが目安の作物です。');
    expect(buildWateringSuggestion(1, '   ')?.reason).toBe('毎日が目安の作物です。');
  });

  it('追肥は1回目の目安日を添える', () => {
    expect(buildFertilizeSuggestion(20, 20)?.reason).toBe(
      '1回目は植え付けから20日ごろが目安。以後20日おきです。',
    );
  });

  it('追肥の間隔が無ければ提案しない', () => {
    expect(buildFertilizeSuggestion(null, 20)).toBeNull();
  });
});

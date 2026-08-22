/**
 * タイムラインを実 SQLite に対してテストする（R05 / WBS 1.9）。
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

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

import { createCareLog } from '../care-log.service';
import { createHarvest } from '../harvest.service';
import { getTimeline, groupByDay } from '../garden-timeline.service';
import { createPlanting } from '../planting.service';
import type { GardenTimelineEntry } from '../types';

const FAMILY_ID = 'family-001';

function seedFamily(): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
  );
}

/** 端末ローカルの日時で N 日前の 12:00 を作る（日付境界のブレを避ける） */
function daysAgoNoon(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('garden-timeline.service (real SQLite)', () => {
  let tomato: string;
  let cucumber: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    tomato = await createPlanting({
      cropName: 'トマト',
      variety: 'アイコ',
      plantedOn: daysAgoNoon(45),
      plantedAs: 'seedling',
      tags: [],
    });
    cucumber = await createPlanting({
      cropName: 'キュウリ',
      plantedOn: daysAgoNoon(30),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  it('栽培をまたいで新しい順に並ぶ', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: daysAgoNoon(3) });
    await createCareLog({ plantingId: cucumber, kind: 'prune', loggedAt: daysAgoNoon(1) });
    await createCareLog({ plantingId: tomato, kind: 'fertilize', loggedAt: daysAgoNoon(7) });

    expect((await getTimeline()).map((entry) => entry.kind)).toEqual([
      'prune',
      'water',
      'fertilize',
    ]);
  });

  it('作物名と品種が載る（どの株の作業か分からないと意味を成さない）', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water' });

    const [entry] = await getTimeline();
    expect(entry.cropName).toBe('トマト');
    expect(entry.variety).toBe('アイコ');
    expect(entry.plantingId).toBe(tomato);
    expect(entry.type).toBe('care_log');
  });

  it('栽培で絞れる（栽培詳細から使う）', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water' });
    await createCareLog({ plantingId: cucumber, kind: 'prune' });

    const entries = await getTimeline({ plantingId: tomato });
    expect(entries).toHaveLength(1);
    expect(entries[0].cropName).toBe('トマト');
  });

  it('期間で絞れる', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: daysAgoNoon(10) });
    await createCareLog({ plantingId: tomato, kind: 'prune', loggedAt: daysAgoNoon(2) });

    const recent = await getTimeline({ from: daysAgoNoon(5) });
    expect(recent.map((entry) => entry.kind)).toEqual(['prune']);

    const old = await getTimeline({ to: daysAgoNoon(5) });
    expect(old.map((entry) => entry.kind)).toEqual(['water']);
  });

  it('件数を制限できる', async () => {
    for (let i = 0; i < 5; i++) {
      await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: daysAgoNoon(i) });
    }
    expect(await getTimeline({ limit: 3 })).toHaveLength(3);
  });

  it('写真が行ごとに正しく載る', async () => {
    await createCareLog({
      plantingId: tomato,
      kind: 'water',
      loggedAt: daysAgoNoon(1),
      photoUris: ['/t1.jpg', '/t2.jpg'],
    });
    await createCareLog({
      plantingId: cucumber,
      kind: 'prune',
      loggedAt: daysAgoNoon(2),
      photoUris: ['/c1.jpg'],
    });

    const entries = await getTimeline();
    expect(entries[0].photoUris).toEqual(['/t1.jpg', '/t2.jpg']);
    expect(entries[1].photoUris).toEqual(['/c1.jpg']);
  });

  it('記録が無ければ空', async () => {
    expect(await getTimeline()).toEqual([]);
  });

  describe('groupByDay', () => {
    function entry(loggedAt: string, id: string): GardenTimelineEntry {
      return {
        id,
        type: 'care_log',
        plantingId: 'p',
        cropName: 'トマト',
        variety: null,
        kind: 'water',
        quantity: null,
        unit: null,
        loggedAt,
        note: null,
        photoUris: [],
      };
    }

    it('同じ日の記録を 1 つにまとめる', () => {
      const days = groupByDay([
        entry(daysAgoNoon(0), 'a'),
        entry(daysAgoNoon(0), 'b'),
        entry(daysAgoNoon(1), 'c'),
      ]);

      expect(days).toHaveLength(2);
      expect(days[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
      expect(days[1].entries.map((e) => e.id)).toEqual(['c']);
    });

    it('端末のタイムゾーンで日付を決める', () => {
      // JST の 0:30 は UTC では前日。toISOString の日付で束ねると 1 日ずれる
      const local = new Date();
      local.setHours(0, 30, 0, 0);
      const days = groupByDay([entry(local.toISOString(), 'a')]);

      const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
        local.getDate(),
      ).padStart(2, '0')}`;
      expect(days[0].date).toBe(expected);
    });

    it('空配列なら空', () => {
      expect(groupByDay([])).toEqual([]);
    });
  });
});

describeIfSqlite('収穫の合流 (R06 / WBS 2.1)', () => {
  let tomato: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    tomato = await createPlanting({
      cropName: 'トマト',
      plantedOn: daysAgoNoon(60),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  it('作業ログと収穫が同じ並びに混ざる', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: daysAgoNoon(3) });
    await createHarvest({
      plantingId: tomato,
      harvestedAt: daysAgoNoon(1),
      quantity: 5,
      unit: 'piece',
    });
    await createCareLog({ plantingId: tomato, kind: 'prune', loggedAt: daysAgoNoon(5) });

    const entries = await getTimeline();
    expect(entries.map((entry) => entry.type)).toEqual(['harvest', 'care_log', 'care_log']);
  });

  it('収穫には数量と単位が載り、kind は null', async () => {
    await createHarvest({ plantingId: tomato, quantity: 300, unit: 'g' });

    const [entry] = await getTimeline();
    expect(entry.type).toBe('harvest');
    expect(entry.quantity).toBe(300);
    expect(entry.unit).toBe('g');
    expect(entry.kind).toBeNull();
    expect(entry.cropName).toBe('トマト');
  });

  it('作業ログには kind が載り、数量は null', async () => {
    await createCareLog({ plantingId: tomato, kind: 'water' });

    const [entry] = await getTimeline();
    expect(entry.kind).toBe('water');
    expect(entry.quantity).toBeNull();
    expect(entry.unit).toBeNull();
  });

  it('同じ時刻なら収穫が先に来る', async () => {
    const when = daysAgoNoon(2);
    await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: when });
    await createHarvest({ plantingId: tomato, harvestedAt: when });

    expect((await getTimeline()).map((entry) => entry.type)).toEqual(['harvest', 'care_log']);
  });

  it('写真が種別をまたいで取り違えられない', async () => {
    await createCareLog({
      plantingId: tomato,
      kind: 'water',
      loggedAt: daysAgoNoon(2),
      photoUris: ['/care.jpg'],
    });
    await createHarvest({
      plantingId: tomato,
      harvestedAt: daysAgoNoon(1),
      photoUris: ['/harvest.jpg'],
    });

    const entries = await getTimeline();
    expect(entries[0].photoUris).toEqual(['/harvest.jpg']);
    expect(entries[1].photoUris).toEqual(['/care.jpg']);
  });

  it('期間の絞り込みが収穫にも効く', async () => {
    await createHarvest({ plantingId: tomato, harvestedAt: daysAgoNoon(10) });
    await createHarvest({ plantingId: tomato, harvestedAt: daysAgoNoon(2) });

    expect(await getTimeline({ from: daysAgoNoon(5) })).toHaveLength(1);
  });

  it('件数制限は混ぜたあとに効く', async () => {
    for (let i = 1; i <= 3; i++) {
      await createCareLog({ plantingId: tomato, kind: 'water', loggedAt: daysAgoNoon(i * 2) });
      await createHarvest({ plantingId: tomato, harvestedAt: daysAgoNoon(i * 2 - 1) });
    }
    // 6 件中、新しい 3 件は 収穫(1) 作業(2) 収穫(3)
    expect((await getTimeline({ limit: 3 })).map((entry) => entry.type)).toEqual([
      'harvest',
      'care_log',
      'harvest',
    ]);
  });
});

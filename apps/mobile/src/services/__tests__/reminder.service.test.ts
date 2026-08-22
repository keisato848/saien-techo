/**
 * リマインダーサービスを実 SQLite に対してテストする（R11 / WBS 2.4）。
 *
 * OS への予約はモックして「何件・どの時刻で積んだか」を見る。
 * 実際に鳴るかは端末でしか確かめられないので、そこは実機確認に任せる。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;
const mockScheduled: { reminderId: string; at: Date }[] = [];
let mockCancelCount = 0;

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

jest.mock('../notification.service', () => ({
  scheduleReminderNotification: (reminder: { id: string }, at: Date) => {
    mockScheduled.push({ reminderId: reminder.id, at });
    return Promise.resolve(true);
  },
  cancelReminderNotifications: () => {
    mockCancelCount += 1;
    return Promise.resolve();
  },
}));

import { endPlanting } from '../planting.service';
import { createPlanting } from '../planting.service';
import { createCareLog } from '../care-log.service';
import {
  createReminder,
  deleteReminder,
  getActiveReminders,
  getReminder,
  getReminders,
  getTodayReminders,
  markReminderFired,
  setReminderEnabled,
  syncScheduledReminders,
  updateReminder,
} from '../reminder.service';

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

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('reminder.service (real SQLite)', () => {
  let plantingId: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    mockScheduled.length = 0;
    mockCancelCount = 0;
    seedFamily();
    plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: new Date().toISOString(),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  describe('createReminder', () => {
    it('毎日のリマインダーを作れる', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      const reminder = await getReminder(id);
      expect(reminder).toMatchObject({
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
        enabled: true,
      });
    });

    it('曜日は正規化して保存する（重複・順不同・範囲外）', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'weekly',
        weekdays: [4, 1, 1, 9, -1],
        hour: 7,
        minute: 0,
      });

      expect((await getReminder(id))?.weekdays).toEqual([1, 4]);
    });

    it('種類に合わない設定は捨てる（毎日なのに曜日が残らない）', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        weekdays: [1, 4],
        intervalDays: 3,
        hour: 7,
        minute: 0,
      });

      const reminder = await getReminder(id);
      expect(reminder?.weekdays).toEqual([]);
      expect(reminder?.intervalDays).toBeNull();
    });

    it('無効な状態でも作れる', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
        enabled: false,
      });

      expect((await getReminder(id))?.enabled).toBe(false);
    });
  });

  describe('getReminders', () => {
    it('時刻順に返す', async () => {
      for (const [hour, minute] of [
        [18, 0],
        [7, 30],
        [7, 0],
      ]) {
        await createReminder({
          plantingId,
          kind: 'water',
          scheduleKind: 'daily',
          hour,
          minute,
        });
      }

      const list = await getReminders(plantingId);
      expect(list.map((r) => `${r.hour}:${r.minute}`)).toEqual(['7:0', '7:30', '18:0']);
    });

    it('他の栽培のものは混ざらない', async () => {
      const other = await createPlanting({
        cropName: 'キュウリ',
        plantedOn: new Date().toISOString(),
        plantedAs: 'seedling',
        tags: [],
      });
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createReminder({
        plantingId: other,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      expect(await getReminders(plantingId)).toHaveLength(1);
    });
  });

  describe('getActiveReminders', () => {
    it('無効なものは外す', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createReminder({
        plantingId,
        kind: 'fertilize',
        scheduleKind: 'daily',
        hour: 8,
        minute: 0,
        enabled: false,
      });

      expect(await getActiveReminders()).toHaveLength(1);
    });

    it('終了した栽培のものは外す（収穫し終えた株に通知が来ない）', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      expect(await getActiveReminders()).toHaveLength(1);

      await endPlanting(plantingId, 'harvested');

      expect(await getActiveReminders()).toHaveLength(0);
    });
  });

  describe('syncScheduledReminders', () => {
    it('積み直す前に必ず全部取り消す', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      mockCancelCount = 0;

      await syncScheduledReminders();

      expect(mockCancelCount).toBe(1);
    });

    it('有効なぶんだけ予約する', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createReminder({
        plantingId,
        kind: 'prune',
        scheduleKind: 'daily',
        hour: 8,
        minute: 0,
        enabled: false,
      });
      mockScheduled.length = 0;

      expect(await syncScheduledReminders()).toBe(1);
    });

    it('設定が欠けていて次回が決まらないものは飛ばす', async () => {
      // 曜日指定なのに曜日が空
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'weekly',
        weekdays: [],
        hour: 7,
        minute: 0,
      });
      mockScheduled.length = 0;

      expect(await syncScheduledReminders()).toBe(0);
    });

    it('予約した時刻は未来である', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      mockScheduled.length = 0;

      await syncScheduledReminders();

      expect(mockScheduled).toHaveLength(1);
      expect(mockScheduled[0].at.getTime()).toBeGreaterThan(Date.now());
    });

    it('栽培を終了すると予約が消える', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await endPlanting(plantingId, 'harvested');
      mockScheduled.length = 0;

      expect(await syncScheduledReminders()).toBe(0);
    });
  });

  describe('updateReminder / setReminderEnabled', () => {
    it('種類を変えると前の設定が残らない', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'weekly',
        weekdays: [1, 4],
        hour: 7,
        minute: 0,
      });

      await updateReminder(id, {
        kind: 'water',
        scheduleKind: 'interval_days',
        intervalDays: 3,
        hour: 7,
        minute: 0,
      });

      const reminder = await getReminder(id);
      expect(reminder?.weekdays).toEqual([]);
      expect(reminder?.intervalDays).toBe(3);
    });

    it('有効/無効を切り替えられる', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      await setReminderEnabled(id, false);
      expect((await getReminder(id))?.enabled).toBe(false);

      await setReminderEnabled(id, true);
      expect((await getReminder(id))?.enabled).toBe(true);
    });

    it('切り替えのたびに予約を積み直す', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      mockCancelCount = 0;

      await setReminderEnabled(id, false);

      expect(mockCancelCount).toBe(1);
    });
  });

  describe('markReminderFired', () => {
    it('鳴った時刻を残す（N 日おきの起点になる）', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'interval_days',
        intervalDays: 3,
        hour: 7,
        minute: 0,
      });
      const firedAt = new Date().toISOString();

      await markReminderFired(id, firedAt);

      expect((await getReminder(id))?.lastFiredAt).toBe(firedAt);
    });
  });

  describe('deleteReminder', () => {
    it('消える', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      await deleteReminder(id);

      expect(await getReminder(id)).toBeNull();
      expect(await getReminders(plantingId)).toHaveLength(0);
    });
  });

  // ホームの「今日のリマインダー」（R11 / WBS 3.5）
  describe('getTodayReminders', () => {
    /** 2026-08-10 は月曜 */
    const MONDAY_NOON = new Date(2026, 7, 10, 12, 0);

    it('今日鳴る予定を作物名つきで返す', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      const today = await getTodayReminders(MONDAY_NOON);

      expect(today).toHaveLength(1);
      expect(today[0]).toMatchObject({ cropName: 'トマト', kind: 'water', done: false });
      expect(today[0].at).toEqual(new Date(2026, 7, 10, 7, 0));
    });

    it('時刻を過ぎていても消えない（やったか確かめたいので）', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });

      const evening = await getTodayReminders(new Date(2026, 7, 10, 22, 0));
      expect(evening).toHaveLength(1);
    });

    it('今日鳴らない曜日は返さない', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'weekly',
        weekdays: [2], // 火曜だけ
        hour: 7,
        minute: 0,
      });

      expect(await getTodayReminders(MONDAY_NOON)).toEqual([]);
    });

    it('無効にしたものは返さない', async () => {
      const id = await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await setReminderEnabled(id, false);

      expect(await getTodayReminders(MONDAY_NOON)).toEqual([]);
    });

    it('終了した栽培のものは返さない（採り終えた株に水やりを促さない）', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await endPlanting(plantingId, 'harvested');

      expect(await getTodayReminders(MONDAY_NOON)).toEqual([]);
    });

    // 済みの判定はリマインダーではなく「その日の記録の有無」で行う
    it('同じ日に同じ種別の記録があれば done', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createCareLog({
        plantingId,
        kind: 'water',
        loggedAt: new Date(2026, 7, 10, 7, 30).toISOString(),
        photoUris: [],
      });

      expect((await getTodayReminders(MONDAY_NOON))[0].done).toBe(true);
    });

    it('種別が違う記録では done にならない', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createCareLog({
        plantingId,
        kind: 'fertilize',
        loggedAt: new Date(2026, 7, 10, 7, 30).toISOString(),
        photoUris: [],
      });

      expect((await getTodayReminders(MONDAY_NOON))[0].done).toBe(false);
    });

    it('前日の記録では done にならない（毎日の予定が済み扱いで埋もれない）', async () => {
      await createReminder({
        plantingId,
        kind: 'water',
        scheduleKind: 'daily',
        hour: 7,
        minute: 0,
      });
      await createCareLog({
        plantingId,
        kind: 'water',
        loggedAt: new Date(2026, 7, 9, 7, 30).toISOString(),
        photoUris: [],
      });

      expect((await getTodayReminders(MONDAY_NOON))[0].done).toBe(false);
    });

    it('時刻順に並べる', async () => {
      for (const hour of [18, 6, 12]) {
        await createReminder({
          plantingId,
          kind: 'water',
          scheduleKind: 'daily',
          hour,
          minute: 0,
        });
      }

      const today = await getTodayReminders(MONDAY_NOON);
      expect(today.map((r) => r.at.getHours())).toEqual([6, 12, 18]);
    });

    it('予定が無ければ空（カードごと出さない）', async () => {
      expect(await getTodayReminders(MONDAY_NOON)).toEqual([]);
    });
  });
});

/**
 * リマインダーサービス — R11 / WBS 2.4
 *
 * 栽培ごとに「水やりを毎朝 7 時」のような繰り返し通知を持つ。
 * サーバーは使わない（私設・ローカルファースト）。OS のローカル通知だけで回す。
 *
 * ## OS への載せ方
 *
 * **種類にかかわらず、次の 1 回だけ**日時指定で予約する。OS の繰り返しトリガーは
 * 毎日と曜日にしか無く、N 日おきだけ別扱いにすると「毎日は鳴るが N 日おきは
 * 止まる」という差が出る。全部同じ載せ方にして、起動時の
 * syncScheduledReminders で積み直す。
 *
 * 代償として**アプリを長く開かないと 2 回目以降が止まる**。
 * 日々開くアプリなので許容するが、ここは将来 OS の繰り返しトリガーと
 * 併用する余地がある。
 *
 * ## Doze の扱い
 *
 * Android の Doze 下では時刻が数十分ずれうる。水やりの声かけに秒精度は要らないので
 * 許容する。**「必ずこの時刻に鳴る」とは言えない**ため、UI でも「おおよその時刻」
 * として見せる。
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { isSameLocalDay, nextOccurrence, occurrenceOn } from '../utils/reminderSchedule';
import { cancelReminderNotifications, scheduleReminderNotification } from './notification.service';
import type { CareLogKind, ReminderItem, ReminderScheduleKind, SaveReminderInput } from './types';

const SCHEDULE_KINDS: readonly string[] = ['daily', 'interval_days', 'weekly'];

function nowIso(): string {
  return new Date().toISOString();
}

/** '0,3' ↔ [0, 3]。空文字と NULL の両方を空配列にする */
function parseWeekdays(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function serializeWeekdays(days: number[] | undefined): string | null {
  const cleaned = [...new Set(days ?? [])]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return cleaned.length > 0 ? cleaned.join(',') : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any): ReminderItem {
  return {
    id: row.id,
    plantingId: row.plantingId,
    kind: row.kind as CareLogKind,
    scheduleKind: (SCHEDULE_KINDS.includes(row.scheduleKind)
      ? row.scheduleKind
      : 'daily') as ReminderScheduleKind,
    intervalDays: row.intervalDays,
    weekdays: parseWeekdays(row.weekdays),
    hour: row.hour,
    minute: row.minute,
    // SQLite に真偽値が無いので integer で持っている
    enabled: row.enabled === 1,
    lastFiredAt: row.lastFiredAt,
    createdAt: row.createdAt,
  };
}

const SELECT_COLUMNS = {
  id: schema.reminders.id,
  plantingId: schema.reminders.plantingId,
  kind: schema.reminders.kind,
  scheduleKind: schema.reminders.scheduleKind,
  intervalDays: schema.reminders.intervalDays,
  weekdays: schema.reminders.weekdays,
  hour: schema.reminders.hour,
  minute: schema.reminders.minute,
  enabled: schema.reminders.enabled,
  lastFiredAt: schema.reminders.lastFiredAt,
  createdAt: schema.reminders.createdAt,
};

/** ある栽培のリマインダー。時刻順 */
export async function getReminders(plantingId: string): Promise<ReminderItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(schema.reminders)
    .where(eq(schema.reminders.plantingId, plantingId))
    .orderBy(asc(schema.reminders.hour), asc(schema.reminders.minute));

  return rows.map(toItem);
}

export async function getReminder(reminderId: string): Promise<ReminderItem | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(schema.reminders)
    .where(eq(schema.reminders.id, reminderId))
    .limit(1);

  return rows.length > 0 ? toItem(rows[0]) : null;
}

/**
 * 有効なリマインダーを全部。
 * **終了した栽培のものは外す。** 収穫し終えた株に水やり通知が来ると信頼を失う。
 */
export async function getActiveReminders(): Promise<ReminderItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(schema.reminders)
    .innerJoin(schema.plantings, eq(schema.reminders.plantingId, schema.plantings.id))
    .where(and(eq(schema.reminders.enabled, 1), isNull(schema.plantings.endedAt)));

  return rows.map(toItem);
}

/** ホームの「今日のリマインダー」1 行分（R11 / WBS 3.5） */
export interface TodayReminder {
  id: string;
  plantingId: string;
  cropName: string;
  kind: CareLogKind;
  /** 鳴る（鳴った）時刻。端末のタイムゾーン */
  at: Date;
  /** 今日この栽培に同じ種別の記録が既にあるか */
  done: boolean;
}

/**
 * 今日鳴る予定のリマインダーを時刻順で（R11 / WBS 3.5）。
 *
 * **時刻を過ぎたものも返す。** 朝 7 時の水やりを 18 時に確かめたいことの方が
 * 多く、過ぎたら消える一覧では「やったか分からない」が残る。
 * 代わりに、同じ日に同じ種別の作業ログがあれば done を立てて済みとして見せる
 * （リマインダー自体は「鳴らした」しか知らないので、実際にやったかは記録で見る）。
 */
export async function getTodayReminders(now: Date = new Date()): Promise<TodayReminder[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select({ ...SELECT_COLUMNS, cropName: schema.plantings.cropName })
    .from(schema.reminders)
    .innerJoin(schema.plantings, eq(schema.reminders.plantingId, schema.plantings.id))
    .where(and(eq(schema.reminders.enabled, 1), isNull(schema.plantings.endedAt)));

  const today: { row: (typeof rows)[number]; at: Date }[] = [];
  for (const row of rows) {
    const at = occurrenceOn(toItem(row), now);
    if (at) today.push({ row, at });
  }
  if (today.length === 0) return [];

  // 今日の作業ログをまとめて引き、栽培×種別で突き合わせる
  const logs = await db
    .select({
      plantingId: schema.careLogs.plantingId,
      kind: schema.careLogs.kind,
      loggedAt: schema.careLogs.loggedAt,
    })
    .from(schema.careLogs)
    .where(inArray(schema.careLogs.plantingId, [...new Set(today.map((t) => t.row.plantingId))]));

  const doneKeys = new Set(
    logs
      .filter((log) => isSameLocalDay(new Date(log.loggedAt), now))
      .map((log) => `${log.plantingId}:${log.kind}`),
  );

  return today
    .map(({ row, at }) => ({
      id: row.id,
      plantingId: row.plantingId,
      cropName: row.cropName,
      kind: row.kind as CareLogKind,
      at,
      done: doneKeys.has(`${row.plantingId}:${row.kind}`),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function createReminder(input: SaveReminderInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('リマインダーの登録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.reminders).values({
    id,
    plantingId: input.plantingId,
    kind: input.kind,
    scheduleKind: input.scheduleKind,
    intervalDays: input.scheduleKind === 'interval_days' ? (input.intervalDays ?? null) : null,
    weekdays: input.scheduleKind === 'weekly' ? serializeWeekdays(input.weekdays) : null,
    hour: input.hour,
    minute: input.minute,
    enabled: input.enabled === false ? 0 : 1,
    lastFiredAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await syncScheduledReminders();
  return id;
}

export async function updateReminder(
  reminderId: string,
  input: Omit<SaveReminderInput, 'plantingId'>,
): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.reminders)
    .set({
      kind: input.kind,
      scheduleKind: input.scheduleKind,
      intervalDays: input.scheduleKind === 'interval_days' ? (input.intervalDays ?? null) : null,
      weekdays: input.scheduleKind === 'weekly' ? serializeWeekdays(input.weekdays) : null,
      hour: input.hour,
      minute: input.minute,
      enabled: input.enabled === false ? 0 : 1,
      updatedAt: nowIso(),
    })
    .where(eq(schema.reminders.id, reminderId));

  await syncScheduledReminders();
}

export async function setReminderEnabled(reminderId: string, enabled: boolean): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.reminders)
    .set({ enabled: enabled ? 1 : 0, updatedAt: nowIso() })
    .where(eq(schema.reminders.id, reminderId));

  await syncScheduledReminders();
}

export async function deleteReminder(reminderId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db.delete(schema.reminders).where(eq(schema.reminders.id, reminderId));
  await syncScheduledReminders();
}

/** 鳴ったことを記録する。N 日おきの起点になる */
export async function markReminderFired(reminderId: string, firedAt = nowIso()): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.reminders)
    .set({ lastFiredAt: firedAt, updatedAt: nowIso() })
    .where(eq(schema.reminders.id, reminderId));
}

/**
 * DB の内容を OS の予約通知へ反映する。
 *
 * **毎回すべて消してから積み直す。** 差分を取る方が速いが、OS 側の予約は
 * アプリの再インストールや OS の掃除で勝手に消えることがあり、
 * 差分では「消えたまま気づかない」が起きる。件数はたかだか数十なので全消しで足りる。
 */
export async function syncScheduledReminders(): Promise<number> {
  if (!isNativePlatform) return 0;

  await cancelReminderNotifications();

  const reminders = await getActiveReminders();
  let scheduled = 0;

  for (const reminder of reminders) {
    const next = nextOccurrence(reminder);
    if (!next) continue;
    const ok = await scheduleReminderNotification(reminder, next);
    if (ok) scheduled += 1;
  }
  return scheduled;
}

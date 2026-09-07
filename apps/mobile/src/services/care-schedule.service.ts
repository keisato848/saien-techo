/**
 * ケアスケジュールの自動提案 — R26 / WBS 4.8
 *
 * 栽培を登録した直後に「水やりのお知らせを 2 日おきに作りますか」と聞く。
 * 4.19 で作物マスターに入った `crop_guides.watering_interval_days` と
 * `fertilize_interval_days` の最初の読み手。
 *
 * ## 勝手に作らない
 *
 * 提案するだけで、**既定では ON にしない**。通知は一度うるさいと思われると
 * OS ごと切られ、リマインダー（R11）全体が死ぬ。「登録したら勝手に毎朝鳴り出した」は
 * その最短経路になる。作るかどうかは利用者が選ぶ。
 *
 * ## すでにお知らせがある栽培には出さない
 *
 * 自分で設定した人に重ねて提案すると、同じ水やりが 2 回鳴る。
 * 1 件でもあれば提案そのものを出さない。
 *
 * ## 追肥は「間隔を持つ作物」だけ
 *
 * リマインダーは毎日・N 日おき・曜日の 3 種類しか持てず、「植え付けから 20 日目に
 * 1 回だけ」を表現できない（reminder.service の冒頭参照）。1 回で済む作物
 * （カブ・コマツナなど fertilizeIntervalDays が null）にお知らせを作ると、
 * 20 日おきに永久に鳴り続ける。**1 回きりの追肥は「つぎの作業」（R10）の担当**なので
 * ここでは出さず、繰り返し追肥する作物（トマト・ナスなど）だけを提案する。
 *
 * 起点は「お知らせを作った日」なので、初回は目安日
 * （fertilizeAfterDays）とぴったりにはならない。提案文でそこに触れて、
 * 利用者が自分で日数を直せるようにしてある。
 */
import { eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { describeSchedule } from '../utils/reminderSchedule';
import { createReminder, getReminders } from './reminder.service';
import type { CareLogKind, ReminderScheduleKind } from './types';

export interface CareScheduleSuggestion {
  kind: CareLogKind;
  scheduleKind: ReminderScheduleKind;
  /** interval_days のときだけ入る */
  intervalDays: number | null;
  hour: number;
  minute: number;
  /** なぜこの間隔なのか。カードに 1 行で添える */
  reason: string;
}

/**
 * 時刻の既定。水やりは朝いちばん、追肥はひと仕事終えたころに置いて
 * **同時に 2 つ鳴らない**ようにする。どちらも ReminderForm の選択肢にある値なので、
 * 作ったあと利用者が直せる。
 */
const WATER_HOUR = 7;
const FERTILIZE_HOUR = 9;

/** 提案の 1 行（「2日おき 7:00」）。既存のお知らせ一覧と同じ関数で作る */
export function describeCareSuggestion(suggestion: CareScheduleSuggestion): string {
  return describeSchedule({
    id: '',
    plantingId: '',
    kind: suggestion.kind,
    scheduleKind: suggestion.scheduleKind,
    intervalDays: suggestion.intervalDays,
    weekdays: [],
    hour: suggestion.hour,
    minute: suggestion.minute,
    enabled: true,
    lastFiredAt: null,
    createdAt: '',
  });
}

/**
 * 水やりの提案を組み立てる純関数。間隔が無い作物（雨まかせの果樹など）は null。
 * 1 日おきは「毎日」に落とす — N 日おきはアプリを開かないと止まるため
 * （reminder.service の冒頭）、同じ意味なら止まらない方を選ぶ。
 */
export function buildWateringSuggestion(
  intervalDays: number | null,
  wateringNote: string | null,
): CareScheduleSuggestion | null {
  if (intervalDays == null || intervalDays < 1) return null;
  return {
    kind: 'water',
    scheduleKind: intervalDays === 1 ? 'daily' : 'interval_days',
    intervalDays: intervalDays === 1 ? null : intervalDays,
    hour: WATER_HOUR,
    minute: 0,
    reason: wateringNote?.trim()
      ? wateringNote.trim()
      : `${intervalDays === 1 ? '毎日' : `${intervalDays}日おき`}が目安の作物です。`,
  };
}

/** 追肥の提案。繰り返しの間隔を持つ作物だけ（冒頭のコメント参照） */
export function buildFertilizeSuggestion(
  intervalDays: number | null,
  firstAfterDays: number | null,
): CareScheduleSuggestion | null {
  if (intervalDays == null || intervalDays < 1) return null;
  return {
    kind: 'fertilize',
    scheduleKind: 'interval_days',
    intervalDays,
    hour: FERTILIZE_HOUR,
    minute: 0,
    reason:
      firstAfterDays != null
        ? `1回目は植え付けから${firstAfterDays}日ごろが目安。以後${intervalDays}日おきです。`
        : `${intervalDays}日おきが目安の作物です。`,
  };
}

/**
 * この栽培に提案できるお知らせ。無ければ空配列。
 *
 * 空になるのは、育成が終わっている / 作物がマスターに無い / ガイドに間隔が無い /
 * すでにお知らせがある、のいずれか。
 */
export async function suggestCareSchedule(plantingId: string): Promise<CareScheduleSuggestion[]> {
  if (!isNativePlatform) return [];

  const db = getDb();

  const plantingRows = await db
    .select({ cropId: schema.plantings.cropId, endedAt: schema.plantings.endedAt })
    .from(schema.plantings)
    .where(eq(schema.plantings.id, plantingId))
    .limit(1);

  const planting = plantingRows[0] as { cropId: string | null; endedAt: string | null } | undefined;
  if (!planting || planting.endedAt != null || !planting.cropId) return [];

  // 自分で設定済みの人には出さない。重ねると同じ水やりが 2 回鳴る
  const existing = await getReminders(plantingId);
  if (existing.length > 0) return [];

  const guideRows = await db
    .select({
      wateringIntervalDays: schema.cropGuides.wateringIntervalDays,
      wateringNote: schema.cropGuides.wateringNote,
      fertilizeAfterDays: schema.cropGuides.fertilizeAfterDays,
      fertilizeIntervalDays: schema.cropGuides.fertilizeIntervalDays,
    })
    .from(schema.cropGuides)
    .where(eq(schema.cropGuides.cropId, planting.cropId))
    .limit(1);

  const guide = guideRows[0] as
    | {
        wateringIntervalDays: number | null;
        wateringNote: string | null;
        fertilizeAfterDays: number | null;
        fertilizeIntervalDays: number | null;
      }
    | undefined;
  if (!guide) return [];

  const suggestions: CareScheduleSuggestion[] = [];
  const watering = buildWateringSuggestion(guide.wateringIntervalDays, guide.wateringNote);
  if (watering) suggestions.push(watering);
  const fertilize = buildFertilizeSuggestion(guide.fertilizeIntervalDays, guide.fertilizeAfterDays);
  if (fertilize) suggestions.push(fertilize);

  return suggestions;
}

/** 選ばれた提案をお知らせとして作る。作った id を返す */
export async function applyCareSchedule(
  plantingId: string,
  suggestions: CareScheduleSuggestion[],
): Promise<string[]> {
  if (!isNativePlatform) return [];

  const created: string[] = [];
  for (const suggestion of suggestions) {
    created.push(
      await createReminder({
        plantingId,
        kind: suggestion.kind,
        scheduleKind: suggestion.scheduleKind,
        intervalDays: suggestion.intervalDays,
        hour: suggestion.hour,
        minute: suggestion.minute,
      }),
    );
  }
  return created;
}

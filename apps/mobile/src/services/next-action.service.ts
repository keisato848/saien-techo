/**
 * 「次の作業」アドバイス — R10 / WBS 3.4・4.19
 *
 * 育成中の栽培ごとに、植え付けからの経過日数と作物ガイドを突き合わせて提案を出す。
 *
 * 出すもの:
 * - 収穫: 目安（収穫の幅があればその最小）を過ぎていて、**まだ収穫の記録が無い**とき。
 *   初収穫を迎えたら以後の提案は止める（毎日採る野菜で毎日出続けるため）
 * - 追肥（初回）: 目安日数を過ぎていて、**まだ一度も追肥していない**とき
 * - 追肥（2 回目以降・4.19）: ガイドが追肥間隔を持つ作物で、前回の追肥から
 *   間隔ぶん経ったとき。収穫が続く期間（harvestDurationDays）を過ぎたら出さない —
 *   片付け間際の株に追肥を勧めても意味が無い
 * - 作業（4.19）: ガイドの `tasks`（摘芯・支柱・土寄せ・間引き・芽かき・摘果・防虫ネット）。
 *   目安日から 3 週間だけ出す（過ぎた作業をいつまでも催促しない）。
 *   済んだかどうかは、作業ログ（剪定 or その他）が目安日の 1 週間前以降に付いているかで見る
 *
 * 「あとで」は 3 日の先送り。恒久の非表示にしないのは、追肥のし忘れが
 * 数日で害になる作物があるから。先送りは app_meta に JSON で持つ
 * （栽培×種類の 2 キーだけの小さな辞書。テーブルを増やすほどではない）。
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import { CROP_TASK_LABEL, type CropTask, type CropTaskKind } from '../db/crop-master';
import * as schema from '../db/schema';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { elapsedDaysFrom } from './planting.service';
import type { CareLogKind } from './types';

export type NextActionKind = 'fertilize' | 'harvest' | CropTaskKind;

export interface NextAction {
  plantingId: string;
  cropName: string;
  kind: NextActionKind;
  /** 植え付けからの経過日数 */
  elapsedDays: number;
  /** ガイドの目安日数（作業なら目安日、繰り返しの追肥なら間隔） */
  thresholdDays: number;
  /** 2 回目以降の追肥のとき、前回の追肥からの日数 */
  sinceLastDays?: number;
  /** 作業の一言（「本葉 5〜6 枚で」など） */
  note?: string;
}

const TASK_KINDS: readonly CropTaskKind[] = [
  'pinch',
  'stake',
  'hill',
  'thin',
  'sucker',
  'fruit-thin',
  'net',
];

/** 作業の目安日から何日まで提案を出し続けるか */
const TASK_GRACE_DAYS = 14;
/** 目安日の何日前からの作業ログを「済み」とみなすか */
const TASK_DONE_LOOKBACK_DAYS = 7;

const SNOOZE_KEY = 'next_action_snooze';
const SNOOZE_DAYS = 3;
const DAY_MS = 86_400_000;

export function isTaskKind(kind: NextActionKind): kind is CropTaskKind {
  return (TASK_KINDS as readonly string[]).includes(kind);
}

/** 記録に使う作業ログの種類。摘芯・芽かき・摘果は剪定、支柱・土寄せ・間引き・ネットはその他 */
export function careLogKindForAction(kind: NextActionKind): CareLogKind {
  switch (kind) {
    case 'fertilize':
      return 'fertilize';
    case 'harvest':
      // 収穫は作業ログでなく収穫記録へ送る。ここに来たら剪定扱いにはしない
      return 'other';
    case 'pinch':
    case 'sucker':
    case 'fruit-thin':
      return 'prune';
    default:
      return 'other';
  }
}

/** ボタンや読み上げに使う短い名前 */
export function nextActionLabel(action: Pick<NextAction, 'kind'>): string {
  if (action.kind === 'harvest') return '収穫';
  if (action.kind === 'fertilize') return '追肥';
  return CROP_TASK_LABEL[action.kind];
}

function snoozeMapKey(plantingId: string, kind: NextActionKind, thresholdDays?: number): string {
  // 同じ作業が 2 回ある作物（土寄せ 35 日と 55 日）を別々に先送りできるよう、目安日も鍵に含める
  return isTaskKind(kind) && thresholdDays != null
    ? `${plantingId}:${kind}:${thresholdDays}`
    : `${plantingId}:${kind}`;
}

async function readSnoozeMap(): Promise<Record<string, string>> {
  try {
    const raw = await getAppMeta(SNOOZE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

/** 「あとで」— この提案を 3 日間出さない */
export async function snoozeNextAction(
  plantingId: string,
  kind: NextActionKind,
  thresholdDays?: number,
  now: Date = new Date(),
): Promise<void> {
  if (!isNativePlatform) return;
  const map = await readSnoozeMap();
  map[snoozeMapKey(plantingId, kind, thresholdDays)] = new Date(
    now.getTime() + SNOOZE_DAYS * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  await setAppMeta(SNOOZE_KEY, JSON.stringify(map));
}

function parseTasks(raw: string | null): CropTask[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (task): task is CropTask =>
        task != null &&
        typeof task === 'object' &&
        typeof (task as CropTask).afterDays === 'number' &&
        (TASK_KINDS as readonly string[]).includes(String((task as CropTask).kind)),
    );
  } catch {
    return [];
  }
}

/**
 * 育成中の全栽培の「次の作業」。ホームのカードが使う。
 * 並びは「収穫が先・次に追肥と作業」— 採り遅れは数日で味が落ちるが、
 * 追肥の遅れ数日は取り返せる。
 */
export async function getNextActions(now: Date = new Date()): Promise<NextAction[]> {
  if (!isNativePlatform) return [];

  const db = getDb();

  // ガイドを持つマスター作物に紐づく、育成中の栽培だけが対象
  const rows = await db
    .select({
      plantingId: schema.plantings.id,
      cropName: schema.plantings.cropName,
      cropId: schema.plantings.cropId,
      plantedOn: schema.plantings.plantedOn,
      fertilizeAfterDays: schema.cropGuides.fertilizeAfterDays,
      fertilizeIntervalDays: schema.cropGuides.fertilizeIntervalDays,
      harvestAfterDays: schema.cropGuides.harvestAfterDays,
      harvestWindowMinDays: schema.cropGuides.harvestWindowMinDays,
      harvestDurationDays: schema.cropGuides.harvestDurationDays,
      tasks: schema.cropGuides.tasks,
    })
    .from(schema.plantings)
    .innerJoin(schema.cropGuides, eq(schema.plantings.cropId, schema.cropGuides.cropId))
    .where(and(isNull(schema.plantings.endedAt), like(schema.plantings.cropId, 'crop-%')));

  if (rows.length === 0) return [];
  const plantingIds = rows.map((row) => row.plantingId);

  // 既にやった作業（種類と日付）をまとめて引く
  const careLogs = await db
    .select({
      plantingId: schema.careLogs.plantingId,
      kind: schema.careLogs.kind,
      loggedAt: schema.careLogs.loggedAt,
    })
    .from(schema.careLogs)
    .where(inArray(schema.careLogs.plantingId, plantingIds));
  const logsByPlanting = new Map<string, { kind: string; loggedAt: string }[]>();
  for (const log of careLogs) {
    const list = logsByPlanting.get(log.plantingId) ?? [];
    list.push({ kind: log.kind, loggedAt: log.loggedAt });
    logsByPlanting.set(log.plantingId, list);
  }
  const harvested = new Set(
    (
      await db
        .select({ plantingId: schema.harvests.plantingId })
        .from(schema.harvests)
        .where(inArray(schema.harvests.plantingId, plantingIds))
    ).map((row) => row.plantingId),
  );

  const snooze = await readSnoozeMap();
  const today = now.toISOString().slice(0, 10);

  const actions: NextAction[] = [];
  for (const row of rows) {
    // 栽培一覧・詳細と同じ数え方（planting.service）に合わせる。
    // 独自に数えると同じ画面で「33日目」と「34日」が並ぶ
    const elapsed = elapsedDaysFrom(row.plantedOn, now.toISOString());
    const logs = logsByPlanting.get(row.plantingId) ?? [];
    // 作業ログを「植え付けから何日目か」に直しておく
    const logDays = logs.map((log) => ({
      kind: log.kind,
      day: elapsedDaysFrom(row.plantedOn, log.loggedAt),
    }));

    const harvestAt = row.harvestWindowMinDays ?? row.harvestAfterDays;
    if (harvestAt != null && elapsed >= harvestAt && !harvested.has(row.plantingId)) {
      actions.push({
        plantingId: row.plantingId,
        cropName: row.cropName,
        kind: 'harvest',
        elapsedDays: elapsed,
        thresholdDays: harvestAt,
      });
    }

    const fertilizeDays = logDays.filter((log) => log.kind === 'fertilize').map((log) => log.day);
    if (fertilizeDays.length === 0) {
      if (row.fertilizeAfterDays != null && elapsed >= row.fertilizeAfterDays) {
        actions.push({
          plantingId: row.plantingId,
          cropName: row.cropName,
          kind: 'fertilize',
          elapsedDays: elapsed,
          thresholdDays: row.fertilizeAfterDays,
        });
      }
    } else if (row.fertilizeIntervalDays != null) {
      // 2 回目以降。シーズンの終わり（初収穫の目安 + 収穫が続く期間）を過ぎたら出さない
      const seasonEnd =
        row.harvestAfterDays != null && row.harvestDurationDays != null
          ? row.harvestAfterDays + row.harvestDurationDays
          : null;
      const sinceLast = elapsed - Math.max(...fertilizeDays);
      if (sinceLast >= row.fertilizeIntervalDays && (seasonEnd == null || elapsed <= seasonEnd)) {
        actions.push({
          plantingId: row.plantingId,
          cropName: row.cropName,
          kind: 'fertilize',
          elapsedDays: elapsed,
          thresholdDays: row.fertilizeIntervalDays,
          sinceLastDays: sinceLast,
        });
      }
    }

    for (const task of parseTasks(row.tasks)) {
      if (elapsed < task.afterDays || elapsed > task.afterDays + TASK_GRACE_DAYS) continue;
      const doneKind = careLogKindForAction(task.kind);
      const done = logDays.some(
        (log) => log.kind === doneKind && log.day >= task.afterDays - TASK_DONE_LOOKBACK_DAYS,
      );
      if (done) continue;
      actions.push({
        plantingId: row.plantingId,
        cropName: row.cropName,
        kind: task.kind,
        elapsedDays: elapsed,
        thresholdDays: task.afterDays,
        note: task.note,
      });
    }
  }

  return actions
    .filter((action) => {
      const until = snooze[snoozeMapKey(action.plantingId, action.kind, action.thresholdDays)];
      return !(until && today < until);
    })
    .sort(
      (a, b) =>
        (a.kind === 'harvest' ? 0 : 1) - (b.kind === 'harvest' ? 0 : 1) ||
        b.elapsedDays - a.elapsedDays,
    );
}

/** 栽培詳細用。この栽培の提案だけ */
export async function getNextActionsForPlanting(
  plantingId: string,
  now: Date = new Date(),
): Promise<NextAction[]> {
  const all = await getNextActions(now);
  return all.filter((action) => action.plantingId === plantingId);
}

/** 提案の文言（R10 の受け入れ基準の文面に合わせる） */
export function describeNextAction(action: NextAction): string {
  if (action.kind === 'harvest') {
    return `収穫適期に入りました（目安 約${action.thresholdDays}日・いま${action.elapsedDays}日目）`;
  }
  if (action.kind === 'fertilize') {
    if (action.sinceLastDays != null) {
      return `そろそろ追肥（前回から${action.sinceLastDays}日・目安 ${action.thresholdDays}日おき）`;
    }
    return `そろそろ追肥（植え付けから${action.elapsedDays}日・目安 約${action.thresholdDays}日）`;
  }
  const base = `${CROP_TASK_LABEL[action.kind]}の時期です（植え付けから${action.elapsedDays}日・目安 約${action.thresholdDays}日）`;
  return action.note ? `${base} ${action.note}` : base;
}

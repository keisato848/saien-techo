/**
 * 「次の作業」アドバイス — R10 / WBS 3.4
 *
 * 育成中の栽培ごとに、植え付けからの経過日数と作物ガイド
 * （fertilizeAfterDays / harvestAfterDays）を突き合わせて提案を出す。
 *
 * 出すのは 2 種類だけ:
 * - 追肥: 目安日数を過ぎていて、**まだ一度も追肥していない**とき。
 *   2 回目以降の追肥は繰り返しリマインダー（R11）の守備範囲 — ここで
 *   周期管理まで抱えると「作物ごとの追肥間隔」という新しいデータが要る
 * - 収穫: 目安日数を過ぎていて、**まだ収穫の記録が無い**とき。
 *   初収穫を迎えたら以後の提案は止める（毎日採る野菜で毎日出続けるため）
 *
 * 「あとで」は 3 日の先送り。恒久の非表示にしないのは、追肥のし忘れが
 * 数日で害になる作物があるから。先送りは app_meta に JSON で持つ
 * （栽培×種類の 2 キーだけの小さな辞書。テーブルを増やすほどではない）。
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { elapsedDaysFrom } from './planting.service';

export type NextActionKind = 'fertilize' | 'harvest';

export interface NextAction {
  plantingId: string;
  cropName: string;
  kind: NextActionKind;
  /** 植え付けからの経過日数 */
  elapsedDays: number;
  /** ガイドの目安日数 */
  thresholdDays: number;
}

const SNOOZE_KEY = 'next_action_snooze';
const SNOOZE_DAYS = 3;
const DAY_MS = 86_400_000;

function snoozeMapKey(plantingId: string, kind: NextActionKind): string {
  return `${plantingId}:${kind}`;
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
  now: Date = new Date(),
): Promise<void> {
  if (!isNativePlatform) return;
  const map = await readSnoozeMap();
  map[snoozeMapKey(plantingId, kind)] = new Date(now.getTime() + SNOOZE_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  await setAppMeta(SNOOZE_KEY, JSON.stringify(map));
}

/**
 * 育成中の全栽培の「次の作業」。ホームのカードが使う。
 * 並びは「収穫が先・次に追肥」— 採り遅れは数日で味が落ちるが、
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
      harvestAfterDays: schema.cropGuides.harvestAfterDays,
    })
    .from(schema.plantings)
    .innerJoin(schema.cropGuides, eq(schema.plantings.cropId, schema.cropGuides.cropId))
    .where(and(isNull(schema.plantings.endedAt), like(schema.plantings.cropId, 'crop-%')));

  if (rows.length === 0) return [];
  const plantingIds = rows.map((row) => row.plantingId);

  // 既にやった作業（追肥・収穫）をまとめて引く
  const fertilized = new Set(
    (
      await db
        .select({ plantingId: schema.careLogs.plantingId })
        .from(schema.careLogs)
        .where(
          and(
            inArray(schema.careLogs.plantingId, plantingIds),
            eq(schema.careLogs.kind, 'fertilize'),
          ),
        )
    ).map((row) => row.plantingId),
  );
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

    if (
      row.harvestAfterDays != null &&
      elapsed >= row.harvestAfterDays &&
      !harvested.has(row.plantingId)
    ) {
      actions.push({
        plantingId: row.plantingId,
        cropName: row.cropName,
        kind: 'harvest',
        elapsedDays: elapsed,
        thresholdDays: row.harvestAfterDays,
      });
    }

    if (
      row.fertilizeAfterDays != null &&
      elapsed >= row.fertilizeAfterDays &&
      !fertilized.has(row.plantingId)
    ) {
      actions.push({
        plantingId: row.plantingId,
        cropName: row.cropName,
        kind: 'fertilize',
        elapsedDays: elapsed,
        thresholdDays: row.fertilizeAfterDays,
      });
    }
  }

  return actions
    .filter((action) => {
      const until = snooze[snoozeMapKey(action.plantingId, action.kind)];
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
  return `そろそろ追肥（植え付けから${action.elapsedDays}日・目安 約${action.thresholdDays}日）`;
}

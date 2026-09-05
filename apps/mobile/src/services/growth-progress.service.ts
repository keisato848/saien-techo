import { eq, inArray } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { elapsedDaysFrom } from './planting.service';
import type { PlantingListItem } from './types';

/**
 * 進行帯（ホームの「育てているもの」）— R16 の周辺 / 設計は `docs/検討-ホームの進行帯と気温.md`
 *
 * 「植え付け → 収穫の目安」までの進み具合を 1 本の帯で見せる。
 *
 * ## 収穫の「窓」（4.19 で追加）
 *
 * 初版は `crop_guides.harvestAfterDays`（単一の日数）しか無く、幅を出せるデータが
 * 無かったので目安を 1 点として扱っていた。4.19 で `harvest_window_min/max_days`
 * （収穫の幅・日数）を持ったので、**帯の右端を幅の最大に置き、最小から先を窓として描く**。
 * 「あと N 日」は窓の最小まで、「採りどき」は窓に入ったら。
 * 幅を持たない作物（旧データ・利用者が足した作物）は従来どおり 1 点で扱う。
 * `crop_calendars` の収穫窓（月単位・地域別）とは混ぜない — 植え付け日と無関係なので
 * 出典が矛盾しうる。
 *
 * ## 目安が無い栽培もある
 *
 * 作物マスターに載っていない自由入力の作物は `harvestAfterDays` を引けない。
 * その場合は**帯を描かず経過日数だけ**にする（0% の帯を出すと「まだ何も進んでいない」に見える）。
 */
/**
 * - `growing`: 目安に向かって育っている
 * - `due`: 目安を過ぎたが、まだ収穫の記録が無い（採りどきの確認を促す）
 * - `harvesting`: 収穫の記録がある。**目安超過を咎めない** — キュウリやシソのような
 *   採り続ける作物は、初収穫の後もシーズン中ずっと育っているのが正常で、
 *   「過ぎています」を出し続けるとオオカミ少年になる（next-action が
 *   初収穫後に提案を止めるのと同じ判断）
 * - `none`: 目安が無い（作物マスターに載っていない自由入力）
 */
export type ProgressState = 'growing' | 'due' | 'harvesting' | 'none';

export interface PlantingProgress {
  plantingId: string;
  state: ProgressState;
  /** 収穫の記録回数。harvesting のときに「何回採れたか」を出すのに使う */
  harvestCount: number;
  /** 植え付けからの経過日数 */
  elapsedDays: number;
  /**
   * 帯の右端（日）。収穫の幅があればその最大、無ければ収穫の目安日数。
   * マスターに無ければ null
   */
  harvestAfterDays: number | null;
  /** 収穫の幅（植え付けからの日数）。マスターが持たなければ null */
  harvestWindow: { min: number; max: number } | null;
  /** 0〜1。目安を過ぎていても 1 で止める（帯が枠を越えない） */
  ratio: number | null;
  /** 収穫の目安（幅があればその最小）まであと何日か。過ぎていれば 0 以下 */
  daysToHarvest: number | null;
  /** 作業ログのあった経過日数（帯の下に打つドット・重複は畳む） */
  logDays: number[];
}

/** 帯に打つドットの上限。増やしても潰れて読めない */
const MAX_LOG_DOTS = 12;

/**
 * 栽培ごとの進み具合をまとめて引く。
 * ホームは栽培を数件しか出さないので、件数ぶんのクエリは 2 本に収める。
 */
export async function getPlantingProgress(
  plantings: PlantingListItem[],
): Promise<Map<string, PlantingProgress>> {
  const result = new Map<string, PlantingProgress>();
  if (!isNativePlatform || plantings.length === 0) return result;

  const db = getDb();
  const plantingIds = plantings.map((planting) => planting.id);

  // 作物マスターの収穫目安。**栽培から join して引く** —
  // 一覧の型（PlantingListItem）は cropId を持たないため、ここで結び直す。
  // 自由入力の作物は crop_guides に行が無いので落ちる（= 目安なし）
  const guides = await db
    .select({
      plantingId: schema.plantings.id,
      harvestAfterDays: schema.cropGuides.harvestAfterDays,
      windowMin: schema.cropGuides.harvestWindowMinDays,
      windowMax: schema.cropGuides.harvestWindowMaxDays,
    })
    .from(schema.plantings)
    .innerJoin(schema.cropGuides, eq(schema.plantings.cropId, schema.cropGuides.cropId))
    .where(inArray(schema.plantings.id, plantingIds));
  const harvestDays = new Map<
    string,
    { target: number; window: { min: number; max: number } | null }
  >();
  for (const guide of guides as {
    plantingId: string;
    harvestAfterDays: number | null;
    windowMin: number | null;
    windowMax: number | null;
  }[]) {
    // 幅は最小 < 最大で両方そろっているときだけ使う（片方だけの行は 1 点扱い）
    const window =
      guide.windowMin != null && guide.windowMax != null && guide.windowMin < guide.windowMax
        ? { min: guide.windowMin, max: guide.windowMax }
        : null;
    const target = window?.max ?? guide.harvestAfterDays;
    if (target != null) harvestDays.set(guide.plantingId, { target, window });
  }

  // 収穫の記録がある栽培（next-action と同じく「初収穫」を状態の切り替え点にする）
  const harvestRows = await db
    .select({ plantingId: schema.harvests.plantingId })
    .from(schema.harvests)
    .where(inArray(schema.harvests.plantingId, plantingIds));
  // 回数まで数える。**満杯の帯は全栽培で同じ見た目になり情報がゼロ**なので、
  // 収穫中は「何回採れたか」を文字で出して差を作る（実機レビュー 2026-08-26）
  const harvestCounts = new Map<string, number>();
  for (const row of harvestRows as { plantingId: string }[]) {
    harvestCounts.set(row.plantingId, (harvestCounts.get(row.plantingId) ?? 0) + 1);
  }

  // 作業ログの日付（帯のドット）
  const logs = await db
    .select({ plantingId: schema.careLogs.plantingId, loggedAt: schema.careLogs.loggedAt })
    .from(schema.careLogs)
    .where(inArray(schema.careLogs.plantingId, plantingIds));
  const logsByPlanting = new Map<string, string[]>();
  for (const log of logs as { plantingId: string; loggedAt: string }[]) {
    const list = logsByPlanting.get(log.plantingId) ?? [];
    list.push(log.loggedAt);
    logsByPlanting.set(log.plantingId, list);
  }

  for (const planting of plantings) {
    const guide = harvestDays.get(planting.id) ?? null;
    const target = guide?.target ?? null;
    const window = guide?.window ?? null;
    // 「採りどき」の境界。幅があれば最小（そこから採れる）、無ければ目安日
    const dueAt = window?.min ?? target;
    const elapsed = planting.elapsedDays;

    // 同じ日の作業は 1 つのドットに畳む（水やり 3 回で 3 個並べても読めない）
    const days = new Set<number>();
    for (const loggedAt of logsByPlanting.get(planting.id) ?? []) {
      const day = elapsedDaysFrom(planting.plantedOn, loggedAt);
      if (day >= 0) days.add(day);
    }
    const logDays = [...days].sort((a, b) => a - b).slice(-MAX_LOG_DOTS);

    const daysToHarvest = dueAt != null ? dueAt - elapsed : null;
    const harvestCount = harvestCounts.get(planting.id) ?? 0;
    const state: ProgressState =
      target == null
        ? 'none'
        : harvestCount > 0
          ? 'harvesting'
          : (daysToHarvest as number) <= 0
            ? 'due'
            : 'growing';

    result.set(planting.id, {
      plantingId: planting.id,
      state,
      harvestCount,
      elapsedDays: elapsed,
      harvestAfterDays: target,
      harvestWindow: window,
      ratio: target && target > 0 ? Math.min(1, elapsed / target) : null,
      daysToHarvest,
      logDays,
    });
  }
  return result;
}

/**
 * 帯の下に出す一行。
 *
 * **実際に使える幅は約 76px（6 文字）しかない。** カード幅は 92px だが
 * 左右の余白を引くとこの程度で、初版の「収穫の目安を N 日 過ぎています」も
 * 差し替え後の「収穫中・50日目」も切れて肝心の数字が見えなかった（実機で 2 回踏んだ）。
 * 「何の話か」は帯そのものが示すので、文字は最小限でよい。
 *
 * 収穫中に**回数**を出すのは、そのとき帯が必ず満杯で全栽培が同じ見た目になり、
 * 帯だけでは情報がゼロになるため。「4回 採れた」なら差が読める。
 */
export function describeProgress(progress: PlantingProgress): string {
  switch (progress.state) {
    case 'none':
      return `${progress.elapsedDays}日目`;
    case 'growing':
      return `あと${progress.daysToHarvest}日`;
    case 'due':
      return '採りどき';
    case 'harvesting':
      return `${progress.harvestCount}回 採れた`;
  }
}

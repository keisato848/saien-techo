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
 * ## 収穫中は軸が変わる（4.19 レビュー 16）
 *
 * 初収穫を記録した瞬間に帯が満杯になり、以後シーズンが終わるまで動かなかった。
 * 28 品目で「満杯固定の期間 ÷ 在圃期間」が平均 37%（バジル 69% / シソ 64%）—
 * **在圃期間の 3 分の 1 以上、帯が何も語らない**。
 * `harvestDurationDays`（採れる期間）を持つ作物だけ、収穫中は軸を
 * 「初収穫 → ＋期間」に切り替える（`bandStartDay` / `bandEndDay`）。
 * 期間を持たない 20 品目は今までどおり満杯のまま — 一度で採り切る作物なので、
 * 「あと何日採れる」に意味が無い。
 * 色は accent のまま（収穫中は正常、という既存判断は変えない）。
 *
 * ## 目安が無い栽培もある
 *
 * 作物マスターに載っていない自由入力の作物は `harvestAfterDays` を引けない。
 * その場合は**帯を描かず経過日数だけ**にする（0% の帯を出すと「まだ何も進んでいない」に見える）。
 */
/**
 * - `growing`: 目安に向かって育っている
 * - `due`: 収穫の幅（無ければ目安）に入ったが、まだ収穫の記録が無い
 * - `over`: **幅の最大も過ぎたのに、まだ収穫の記録が無い**（4.19 レビュー 10）。
 *   幅を持ったのに `due` のままだと「採りどき」が終わらず、
 *   ダイコンの 60 日目も 120 日目も同じ表示になっていた。
 *   咎める文言にはしない — 採り遅れは責めても戻らない
 * - `harvesting`: 収穫の記録がある。**目安超過を咎めない** — キュウリやシソのような
 *   採り続ける作物は、初収穫の後もシーズン中ずっと育っているのが正常で、
 *   「過ぎています」を出し続けるとオオカミ少年になる（next-action が
 *   初収穫後に提案を止めるのと同じ判断）
 * - `none`: 目安が無い（作物マスターに載っていない自由入力）
 */
export type ProgressState = 'growing' | 'due' | 'over' | 'harvesting' | 'none';

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
  /** 収穫が続く期間（日）。マスターが持たなければ null（＝一度で採り切る） */
  harvestDurationDays: number | null;
  /**
   * 帯の左端（植え付けからの日数）。ふだんは 0 だが、
   * **収穫中で採り入れ期間が分かるときだけ初収穫の日**に移る（軸の切り替え・レビュー 16）
   */
  bandStartDay: number;
  /** 帯の右端（植え付けからの日数）。目安が無ければ null */
  bandEndDay: number | null;
  /** 収穫中で採り入れ期間が分かるとき、あと何日採れるか（過ぎていれば null） */
  daysLeftInHarvest: number | null;
  /** 0〜1。右端を過ぎていても 1 で止める（帯が枠を越えない） */
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
      durationDays: schema.cropGuides.harvestDurationDays,
    })
    .from(schema.plantings)
    .innerJoin(schema.cropGuides, eq(schema.plantings.cropId, schema.cropGuides.cropId))
    .where(inArray(schema.plantings.id, plantingIds));
  const harvestDays = new Map<
    string,
    {
      target: number;
      window: { min: number; max: number } | null;
      durationDays: number | null;
    }
  >();
  for (const guide of guides as {
    plantingId: string;
    harvestAfterDays: number | null;
    windowMin: number | null;
    windowMax: number | null;
    durationDays: number | null;
  }[]) {
    // 幅は最小 < 最大で両方そろっているときだけ使う（片方だけの行は 1 点扱い）
    const window =
      guide.windowMin != null && guide.windowMax != null && guide.windowMin < guide.windowMax
        ? { min: guide.windowMin, max: guide.windowMax }
        : null;
    const target = window?.max ?? guide.harvestAfterDays;
    if (target != null)
      harvestDays.set(guide.plantingId, { target, window, durationDays: guide.durationDays });
  }

  // 収穫の記録がある栽培（next-action と同じく「初収穫」を状態の切り替え点にする）。
  // **日付も引く**（クエリは増やさない）— 初収穫の日が採り入れ期間の帯の左端になる
  const harvestRows = await db
    .select({
      plantingId: schema.harvests.plantingId,
      harvestedAt: schema.harvests.harvestedAt,
    })
    .from(schema.harvests)
    .where(inArray(schema.harvests.plantingId, plantingIds));
  // 回数まで数える。**満杯の帯は全栽培で同じ見た目になり情報がゼロ**なので、
  // 収穫中は「何回採れたか」を文字で出して差を作る（実機レビュー 2026-08-26）
  const harvestCounts = new Map<string, number>();
  const firstHarvestAt = new Map<string, string>();
  for (const row of harvestRows as { plantingId: string; harvestedAt: string }[]) {
    harvestCounts.set(row.plantingId, (harvestCounts.get(row.plantingId) ?? 0) + 1);
    const current = firstHarvestAt.get(row.plantingId);
    if (current == null || row.harvestedAt < current) {
      firstHarvestAt.set(row.plantingId, row.harvestedAt);
    }
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
          : window != null && elapsed > window.max
            ? 'over'
            : (daysToHarvest as number) <= 0
              ? 'due'
              : 'growing';

    // 収穫中の帯の軸。**28 品目で「満杯固定の期間 ÷ 在圃期間」が平均 37%**
    // （バジル 69% / シソ 64%）あり、その間ずっと帯が右端に貼りついて動かなかった。
    // 採り入れ期間が分かる作物だけ、軸を「初収穫 → ＋期間」に切り替える（レビュー 16）。
    // 期間を持たない作物は今までどおり（＝満杯のまま・回数で差を出す）
    const durationDays = guide?.durationDays ?? null;
    const firstHarvestIso = firstHarvestAt.get(planting.id);
    const firstHarvestDay =
      firstHarvestIso != null
        ? Math.max(0, elapsedDaysFrom(planting.plantedOn, firstHarvestIso))
        : null;
    const onHarvestAxis = state === 'harvesting' && durationDays != null && firstHarvestDay != null;
    const bandStartDay = onHarvestAxis ? (firstHarvestDay as number) : 0;
    const bandEndDay = onHarvestAxis
      ? (firstHarvestDay as number) + (durationDays as number)
      : target;
    const daysLeft = onHarvestAxis ? (bandEndDay as number) - elapsed : null;

    result.set(planting.id, {
      plantingId: planting.id,
      state,
      harvestCount,
      elapsedDays: elapsed,
      harvestAfterDays: target,
      harvestWindow: window,
      harvestDurationDays: durationDays,
      bandStartDay,
      bandEndDay,
      daysLeftInHarvest: daysLeft != null && daysLeft > 0 ? daysLeft : null,
      ratio:
        bandEndDay != null && bandEndDay > bandStartDay
          ? Math.min(1, Math.max(0, (elapsed - bandStartDay) / (bandEndDay - bandStartDay)))
          : null,
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
 *
 * 採り入れ期間が分かる作物の「あと30日 採れる」だけは 6 文字に収まらない。
 * **数字を先頭に置いてあるので、末尾が切れても肝心のところは読める** —
 * 実機で踏んだ 2 件はどちらも数字が末尾にあって消えたケースだった。
 */
export function describeProgress(progress: PlantingProgress): string {
  switch (progress.state) {
    case 'none':
      return `${progress.elapsedDays}日目`;
    case 'growing':
      return `あと${progress.daysToHarvest}日`;
    case 'due':
      return '採りどき';
    case 'over':
      // 咎めない。「過ぎています」ではなく、終わりが近いことだけ伝える
      return '終わりごろ';
    case 'harvesting':
      // 採り入れ期間が分かるなら残りを出す。分からなければ従来どおり回数
      return progress.daysLeftInHarvest != null
        ? `あと${progress.daysLeftInHarvest}日 採れる`
        : `${progress.harvestCount}回 採れた`;
  }
}

/**
 * 読み上げ用の一行。**`describeProgress` とは別物**。
 *
 * `describeProgress` は幅 76px（6 文字）に収める都合で「あと15日」まで削っており、
 * 読み上げにはそのまま使えない。読み上げは幅の制約を受けないので、
 * 帯が**目で示していること**（今日の位置・収穫の窓・作業ログのドット）を
 * ここで言葉にする。帯に a11y 属性が 1 つも無く、4.19 の目玉である収穫の窓が
 * 読み上げに存在しなかったため（2026-09-07 レビュー 36）。
 */
export function describeProgressForA11y(progress: PlantingProgress): string {
  const parts = [`植え付けから${progress.elapsedDays}日目`];
  switch (progress.state) {
    case 'none':
      parts.push('収穫の目安は分かりません');
      break;
    case 'growing':
      parts.push(`収穫の目安まであと${progress.daysToHarvest}日`);
      break;
    case 'due': {
      const over = -(progress.daysToHarvest as number);
      parts.push(
        over > 0 ? `収穫の目安を${over}日過ぎています。採りどき` : '今日が収穫の目安。採りどき',
      );
      break;
    }
    case 'harvesting':
      parts.push(`これまでに${progress.harvestCount}回 収穫しました`);
      break;
  }
  if (progress.harvestWindow) {
    parts.push(
      `収穫の目安は植え付けから${progress.harvestWindow.min}日〜${progress.harvestWindow.max}日`,
    );
  } else if (progress.harvestAfterDays != null) {
    parts.push(`収穫の目安は植え付けから${progress.harvestAfterDays}日`);
  }
  if (progress.logDays.length > 0) parts.push(`作業の記録${progress.logDays.length}件`);
  return parts.join('。');
}

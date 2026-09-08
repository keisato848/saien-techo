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
 *   間隔ぶん経ったとき。**間隔ごとに 2 週間だけ**出し、過ぎたらいったん引っ込めて
 *   次の間隔でまた出す（催促しっぱなしにしない）。シーズンの終わり
 *   （収穫の幅の最大 + 採れる期間）を過ぎたら出さない — 片付け間際の株に
 *   追肥を勧めても意味が無い。一度で採り切る作物は初収穫を記録した時点で止める
 * - 作業（4.19）: ガイドの `tasks`（摘芯・支柱・土寄せ・間引き・芽かき・摘果・防虫ネット）。
 *   目安日から 2 週間だけ出す（過ぎた作業をいつまでも催促しない）。
 *   済んだかどうかは **care_logs.task_kind の一致**で見る（v16）
 *
 * ## 済み判定が 2 語彙に潰れていた問題（4.19 レビュー 6 / v16 で修正）
 *
 * 初版は作業 7 種を `careLogKindForAction` で `prune` / `other` の 2 値に畳み、
 * 「その種類のログが目安日の 1 週間前以降にあるか」だけを見ていた。
 * **草取り 1 件（その他）で支柱・土寄せ・間引き・防虫ネットの提案がまとめて消える。**
 * 実データで 16 組が互いを潰していた（ハクサイ net@1 → hill@20 など）。
 * v16 で `care_logs.task_kind` を持ち、提案からの記録はそこに作業そのものを残す。
 * **task_kind が NULL の行（手書き・v16 より前）だけ**、従来どおり kind の一致で
 * 済みとみなす — 既存データが一斉に「未済」へ戻らないようにするため。
 *
 * ## リマインダーとの棲み分け（4.19 レビュー 13）
 *
 * 追肥は 2 つの経路から催促できる: ここ（ガイドの間隔）と、利用者が置いた
 * リマインダー（R11。`care-schedule.service` が自動提案する）。両方鳴ると
 * 同じ株に 1 日 2 回「追肥」が出る。**リマインダーが優先**とし、その栽培に
 * enabled な `kind='fertilize'` のリマインダーがあれば 2 回目以降の追肥は出さない。
 * 初回（ガイドの `fertilizeAfterDays`）は「シーズンで一度きり」の別物なので残す。
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
  /**
   * 収穫のとき、幅の最大（植え付けからの日数）。マスターが幅を持たなければ未設定。
   * 「採りどきが終わった」を言えるようにするために持つ（4.19 レビュー 10）
   */
  windowMaxDays?: number;
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

/**
 * 並びの中の重み（小さいほど先）。**取り返しがつくかどうか**で分ける。
 *
 * - 防虫ネット・支柱は**植え付け直後の数日を逃すと後から取り返せない**
 *   （虫が入ったあとに張っても遅い / 根を張ってから挿すと根を切る）
 * - 間引き・土寄せは遅れると株が痩せるが、やれば戻る
 * - 摘芯・芽かき・摘果は数日ずれても実害が小さい
 *
 * 経過日数の降順だけで並べていた頃は、目安 10 日以内の作業（81 件中 23 件）が
 * 常に最下位に沈み、カードの表示上限（2 件）に一度も乗らないまま
 * 猶予 14 日で消えていた（4.19 レビュー 5）。
 */
const CROP_TASK_PRIORITY: Record<CropTaskKind, number> = {
  net: 0,
  stake: 0,
  thin: 1,
  hill: 1,
  pinch: 2,
  sucker: 2,
  'fruit-thin': 2,
};
/** 収穫・追肥は作業の重みを持たない。作業より後ろに置く */
const NON_TASK_PRIORITY = 9;

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

/**
 * 読み上げラベル用の名前。作業は目安日を添えて**一意にする**。
 *
 * カブは間引きが 10 日と 20 日の 2 回あり、20〜24 日目は両方が猶予の中に入る。
 * 名前だけだと 2 つの「記録する」が同じラベルになり、読み上げでも区別できず、
 * `getByLabelText` は複数一致で例外になる（4.19 レビュー 12）。
 */
export function nextActionRecordLabel(action: Pick<NextAction, 'kind' | 'thresholdDays'>): string {
  const label = nextActionLabel(action);
  return isTaskKind(action.kind) ? `${label}（${action.thresholdDays}日目安）` : label;
}

/**
 * 「記録する」の遷移先。
 *
 * 収穫は収穫記録へ。作業は作業ログへ送るが、**kind だけでなく task も渡す** —
 * kind は 6 語彙しか無く、土寄せも間引きも防虫ネットも `other` になってしまい、
 * タイムラインに「その他」としか残らなかった（4.19 レビュー 6）。
 * ガイドの一言（note）はメモの下書きとして渡す。
 */
export function nextActionRecordHref(
  action: Pick<NextAction, 'plantingId' | 'kind' | 'note'>,
): string {
  if (action.kind === 'harvest') return `/plantings/${action.plantingId}/harvests/new`;
  const query = [`kind=${careLogKindForAction(action.kind)}`];
  if (isTaskKind(action.kind)) query.push(`task=${action.kind}`);
  if (action.note) query.push(`note=${encodeURIComponent(action.note)}`);
  return `/plantings/${action.plantingId}/care-logs/new?${query.join('&')}`;
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
 *
 * 並びは 4 段（4.19 レビュー 5）:
 *
 * 1. **収穫が先** — 採り遅れは数日で味が落ちるが、追肥の遅れ数日は取り返せる
 * 2. **猶予の残りが少ない順** — 先に消えるものを先に出す。作業は目安日 + 2 週間で
 *    黙って消えるので、後回しにすると「見せないまま消えた」になる
 * 3. **作業の重み**（`CROP_TASK_PRIORITY`）— 取り返しのつかないものが先
 * 4. 経過日数の降順
 *
 * 1 と 4 だけで並べていた頃は、目安 10 日以内の作業（81 件中 23 件）が
 * 常に最下位に沈み、カードの表示上限（2 件）に一度も乗らなかった。
 * **植え付け直後の防虫ネットが、いちばん出したいときに出ない。**
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
      harvestWindowMaxDays: schema.cropGuides.harvestWindowMaxDays,
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
      taskKind: schema.careLogs.taskKind,
      loggedAt: schema.careLogs.loggedAt,
    })
    .from(schema.careLogs)
    .where(inArray(schema.careLogs.plantingId, plantingIds));
  const logsByPlanting = new Map<
    string,
    { kind: string; taskKind: string | null; loggedAt: string }[]
  >();
  for (const log of careLogs) {
    const list = logsByPlanting.get(log.plantingId) ?? [];
    list.push({ kind: log.kind, taskKind: log.taskKind ?? null, loggedAt: log.loggedAt });
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

  // 追肥のリマインダーを置いてある栽培。2 回目以降の追肥はそちらに任せる（レビュー 13）。
  // 行が増える LEFT JOIN ではなく集合で引く — 1 栽培に複数のリマインダーが並ぶと、
  // join では栽培の行が複製されて提案が二重になる
  const fertilizeReminded = new Set(
    (
      await db
        .select({ plantingId: schema.reminders.plantingId })
        .from(schema.reminders)
        .where(
          and(
            inArray(schema.reminders.plantingId, plantingIds),
            eq(schema.reminders.kind, 'fertilize'),
            eq(schema.reminders.enabled, 1),
          ),
        )
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
      taskKind: log.taskKind,
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
        ...(row.harvestWindowMinDays != null && row.harvestWindowMaxDays != null
          ? { windowMaxDays: row.harvestWindowMaxDays }
          : {}),
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
    } else if (row.fertilizeIntervalDays != null && !fertilizeReminded.has(row.plantingId)) {
      // 2 回目以降。
      //
      // シーズンの終わり = **収穫の幅の最大（無ければ目安）＋ 採れる期間**。
      // 以前は `harvestAfterDays != null && harvestDurationDays != null` の
      // 両方が要り、採れる期間を持たない作物（= 一度で採り切る 9 品目）で
      // seasonEnd が null になっていた。**いちばん止めたい作物ほど止まらない**（レビュー 4）
      const interval = row.fertilizeIntervalDays;
      const harvestEnd = row.harvestWindowMaxDays ?? row.harvestAfterDays;
      const seasonEnd = harvestEnd != null ? harvestEnd + (row.harvestDurationDays ?? 0) : null;
      // 一度で採り切る作物は、採ってしまえば追肥は要らない
      const pickedOnce = row.harvestDurationDays == null && harvested.has(row.plantingId);
      const sinceLast = elapsed - Math.max(...fertilizeDays);
      // 間隔ごとに TASK_GRACE_DAYS だけ出す。過ぎたらいったん引っ込め、
      // 次の間隔でまた出す（作業と同じ扱い。催促しっぱなしにしない）
      const cycles = Math.floor(sinceLast / interval);
      const overdue = sinceLast - cycles * interval;
      if (
        cycles >= 1 &&
        overdue <= TASK_GRACE_DAYS &&
        !pickedOnce &&
        (seasonEnd == null || elapsed <= seasonEnd)
      ) {
        actions.push({
          plantingId: row.plantingId,
          cropName: row.cropName,
          kind: 'fertilize',
          elapsedDays: elapsed,
          thresholdDays: interval,
          sinceLastDays: sinceLast,
        });
      }
    }

    for (const task of parseTasks(row.tasks)) {
      if (elapsed < task.afterDays || elapsed > task.afterDays + TASK_GRACE_DAYS) continue;
      const since = task.afterDays - TASK_DONE_LOOKBACK_DAYS;
      // 記録された作業そのもので判定する（v16）。**task_kind を持つログは
      // kind を見ない** — 見てしまうと「その他」の作業がまた互いを消し合う
      const doneKind = careLogKindForAction(task.kind);
      const done = logDays.some((log) =>
        log.taskKind != null
          ? log.taskKind === task.kind && log.day >= since
          : // v16 より前・手書きのログ。既存データが一斉に「未済」へ戻らないよう
            // 従来どおり kind の一致で済みとみなす
            log.kind === doneKind && log.day >= since,
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
        compareGraceLeft(a, b) ||
        actionPriority(a) - actionPriority(b) ||
        b.elapsedDays - a.elapsedDays,
    );
}

/**
 * 消えるまでの残り日数。**先に消えるものを先に出す。**
 * 収穫・追肥は猶予で消えないので後ろ（Infinity）。
 */
function graceLeftDays(action: NextAction): number {
  return isTaskKind(action.kind)
    ? action.thresholdDays + TASK_GRACE_DAYS - action.elapsedDays
    : Number.POSITIVE_INFINITY;
}

/** Infinity 同士の引き算は NaN になり、比較関数が壊れる（並びが端末ごとに変わる） */
function compareGraceLeft(a: NextAction, b: NextAction): number {
  const left = graceLeftDays(a);
  const right = graceLeftDays(b);
  return left === right ? 0 : left - right;
}

function actionPriority(action: NextAction): number {
  return isTaskKind(action.kind) ? CROP_TASK_PRIORITY[action.kind] : NON_TASK_PRIORITY;
}

/** 栽培詳細用。この栽培の提案だけ */
export async function getNextActionsForPlanting(
  plantingId: string,
  now: Date = new Date(),
): Promise<NextAction[]> {
  const all = await getNextActions(now);
  return all.filter((action) => action.plantingId === plantingId);
}

/**
 * 提案の文言（R10 の受け入れ基準の文面に合わせる）。
 *
 * 収穫は 3 通り（4.19 レビュー 10）。幅の最大を持ったのに「適期に入りました」しか
 * 言えず、**採りどきが終わっても同じ文で出続けていた**:
 *
 * - 窓の中: 「収穫適期に入りました」
 * - 窓を過ぎた: 咎めずに終わりが近いことだけ伝える（採り遅れは責めても戻らない）
 * - 窓を持たない旧データ: 従来の 1 点の文面のまま
 */
export function describeNextAction(action: NextAction): string {
  if (action.kind === 'harvest') {
    if (action.windowMaxDays == null) {
      return `収穫適期に入りました（目安 約${action.thresholdDays}日・いま${action.elapsedDays}日目）`;
    }
    if (action.elapsedDays > action.windowMaxDays) {
      return `そろそろ終わり（目安 ${action.thresholdDays}〜${action.windowMaxDays}日・いま${action.elapsedDays}日目）かたくなる前に`;
    }
    return `収穫適期に入りました（目安 ${action.thresholdDays}〜${action.windowMaxDays}日・いま${action.elapsedDays}日目）`;
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

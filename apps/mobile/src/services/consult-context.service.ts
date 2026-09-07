/**
 * AI 相談に添える文脈と質問チップ — R15 / WBS 4.14（#138）
 *
 * 相談画面は `PlantingDetail` を丸ごと読んでいるのに、サーバーへ送っていたのは
 * **作物名と相談文だけ**だった。品種も経過日数も場所も、画面に出しておきながら
 * 捨てていたので、良い答えが欲しい人は画面に見えている情報を質問欄へ打ち直す
 * しかなかった。ここはそれをアプリ側で埋める。
 *
 * **新しい AI 呼び出しは増やさない。** 送るのは既存の 1 回のリクエストに
 * 相乗りする短いテキストだけで、増えるのは 100〜200 トークン程度（#138）。
 *
 * ─── 何を送るか（判断） ───────────────────────────────────────────────
 * 送る（写真に写らない・モデルが知りようがない・答えが変わる）:
 *   品種 / 経過日数と種苗の別 / 場所（種類と名前）/ 科 /
 *   収穫の目安といまの位置 / 直近の作業（種別と「何日前」だけ）/ いまの時期
 * 送らない（理由つき）:
 *   - **発芽適温・生育適温**: モデルが元から知っている一般知識。しかも
 *     いまの気温を持っていないので比較できず、トークンだけ増える
 *   - **連作年数**: 前に何を植えたかの履歴を持っていない（R17 は未実装）ので
 *     材料にならない
 *   - **commonPests の一覧**: これは**チップ**として人に選ばせる。プロンプトに
 *     並べると、写真に関係なくその名前を答える誘導になる（#138 の「外したときに
 *     誘導になる」と同じ話）
 *   - **作業ログのメモ本文・栽培メモ・タグ**: 利用者の自由文。長さが読めないうえ、
 *     診断に効く保証がない。作業は「種別と何日前か」まで送れば足りる
 *
 * 組み立てた行は**画面にそのまま出す**（相談画面の「一緒に送る情報」）。
 * 何を送っているか分からないまま送信するのは「私設・ローカルファースト」に反する。
 */
import { desc, eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { PLANTED_AS_LABEL } from '../validation/planting.schema';
import { CARE_KIND_LABEL } from './care-log.service';
import type { ConsultContextLine } from './garden-consult.service';
import { PLACE_KIND_LABEL } from './place.service';
import type { CareLogKind, PlantingDetail } from './types';

/** 送る作業ログの件数。多いほど効くわけではなく、直近だけで十分 */
const RECENT_CARE_LOG_COUNT = 3;
/** 場所の名前は利用者の自由文。長い名前をそのまま送らないよう頭だけにする */
const PLACE_NAME_MAX_LENGTH = 20;
/** チップに出す虫・病気の数。5 つ並べると選ぶ前に読む量が増える */
const PEST_CHIP_COUNT = 3;

const DAY_MS = 86_400_000;

/**
 * 症状を言葉にできない人向けの汎用チップ（#138）。
 * 作物によらず当てはまり、写真だけでは区別できないものを選んである。
 */
export const GENERIC_QUESTION_CHIPS: readonly string[] = [
  '葉が黄色くなってきた',
  '葉に穴や食べあとがある',
  'しおれてきた',
  '実がつかない',
  '白い粉のようなものがある',
];

export interface ConsultContext {
  /** サーバーへ送る行。画面にもこのまま出す */
  lines: ConsultContextLine[];
  /** 質問チップ。タップで入力欄に入る */
  chips: string[];
}

export const EMPTY_CONSULT_CONTEXT: ConsultContext = { lines: [], chips: [] };

/** buildConsultContext の材料。DB を読まずに組み立てを検証できるよう分けてある */
export interface ConsultContextInput {
  planting: Pick<PlantingDetail, 'variety' | 'placeName' | 'plantedAs' | 'elapsedDays'> | null;
  /** 場所の種類（planter/row/plot/other）。未設定なら null */
  placeKind: string | null;
  guide: {
    family: string | null;
    harvestAfterDays: number | null;
    harvestWindow: { min: number; max: number } | null;
    commonPests: string[];
  } | null;
  /** 新しい順の作業ログ */
  recentCareLogs: { kind: CareLogKind; daysAgo: number }[];
  now: Date;
}

/** 「今日」「昨日」「3日前」。相談文に絶対日付を並べても読みにくいだけ */
export function formatDaysAgo(daysAgo: number): string {
  if (daysAgo <= 0) return '今日';
  if (daysAgo === 1) return '昨日';
  return `${daysAgo}日前`;
}

/** 「9月上旬」。モデルは今日の日付を知らないので、季節の判断材料として添える */
export function formatSeasonPoint(now: Date): string {
  const day = now.getDate();
  const part = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
  return `${now.getMonth() + 1}月${part}`;
}

/**
 * 収穫の目安に対していまどこにいるか。
 * 「実がつかない」の答えは、まだ早いのか遅いのかで正反対になる。
 */
export function describeHarvestStage(
  elapsedDays: number,
  harvestAfterDays: number | null,
  harvestWindow: { min: number; max: number } | null,
): string | null {
  const min = harvestWindow?.min ?? harvestAfterDays;
  if (min == null) return null;
  const max = harvestWindow?.max ?? null;
  const rangeText = max != null ? `約${min}〜${max}日` : `約${min}日`;
  const stage =
    elapsedDays < min
      ? '収穫期の前'
      : max == null || elapsedDays <= max
        ? '収穫期のなか'
        : '収穫期を過ぎたころ';
  return `${rangeText}・いまは${stage}`;
}

/** 虫・病気の名前からチップ文を作る。括弧の補足はチップには長いので落とす */
function pestChipText(pest: string): string {
  const head = pest.replace(/[（(].*$/u, '').trim();
  return `${head || pest}かもしれません`;
}

/**
 * 質問チップ。作物のよくある虫・病気を先に、汎用の症状を後に置く。
 * **AI 呼び出しゼロ・オフラインでも出る**（#138）。
 */
export function buildQuestionChips(commonPests: readonly string[] = []): string[] {
  const chips = [
    ...commonPests.slice(0, PEST_CHIP_COUNT).map(pestChipText),
    ...GENERIC_QUESTION_CHIPS,
  ];
  return [...new Set(chips)];
}

/**
 * チップを相談文へ足す。**置き換えない** — 自由入力を殺さないのが #138 の要件で、
 * 「うどんこ病かも」と「先週から増えている」は両方あって初めて意味を持つ。
 * 同じチップを二度押しても増やさない（誤タップで同じ文が並ばないように）。
 */
export function appendQuestionChip(current: string, chip: string): string {
  const base = current.trimEnd();
  if (base.length === 0) return chip;
  if (base.split('\n').includes(chip)) return current;
  return `${base}\n${chip}`;
}

/** 材料 → 送る行とチップ。純関数（DB を読まない） */
export function buildConsultContext(input: ConsultContextInput): ConsultContext {
  const lines: ConsultContextLine[] = [];
  const { planting, guide } = input;

  const variety = planting?.variety?.trim();
  if (variety) lines.push({ label: '品種', value: variety });

  if (planting) {
    lines.push({
      label: '経過',
      value: `${PLANTED_AS_LABEL[planting.plantedAs]}・${planting.elapsedDays}日目`,
    });
  }

  const placeName = planting?.placeName?.trim().slice(0, PLACE_NAME_MAX_LENGTH);
  const placeKindLabel = input.placeKind ? PLACE_KIND_LABEL[input.placeKind] : undefined;
  // 種類（プランターか地植えか）は水やり・根の張りの助言を変えるので、名前より効く。
  // 名前は利用者が付けた自由文なので、種類が分かっているときは補足として括弧に入れる
  if (placeKindLabel && placeName) {
    lines.push({ label: '場所', value: `${placeKindLabel}（${placeName}）` });
  } else if (placeKindLabel || placeName) {
    lines.push({ label: '場所', value: placeKindLabel ?? (placeName as string) });
  }

  if (guide?.family) lines.push({ label: '科', value: guide.family });

  if (planting && guide) {
    const harvest = describeHarvestStage(
      planting.elapsedDays,
      guide.harvestAfterDays,
      guide.harvestWindow,
    );
    if (harvest) lines.push({ label: '収穫の目安', value: harvest });
  }

  if (input.recentCareLogs.length > 0) {
    lines.push({
      label: '直近の作業',
      value: input.recentCareLogs
        .slice(0, RECENT_CARE_LOG_COUNT)
        .map((log) => `${formatDaysAgo(log.daysAgo)}に${CARE_KIND_LABEL[log.kind]}`)
        .join('、'),
    });
  }

  lines.push({ label: 'いまの時期', value: formatSeasonPoint(input.now) });

  return { lines, chips: buildQuestionChips(guide?.commonPests ?? []) };
}

function parsePests(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    // 壊れた JSON でチップを 0 件にはしない（汎用チップは出したい）
    return [];
  }
}

/**
 * 相談画面が持っている `PlantingDetail` に、DB の情報を足して文脈を作る。
 * 栽培そのものは画面が既に読んでいるので読み直さない。
 */
export async function getConsultContext(
  planting: PlantingDetail | null,
  now: Date = new Date(),
): Promise<ConsultContext> {
  if (!isNativePlatform || planting == null) {
    return { lines: [], chips: buildQuestionChips() };
  }

  const db = getDb();

  let guide: ConsultContextInput['guide'] = null;
  if (planting.cropId) {
    const rows = await db
      .select({
        family: schema.crops.family,
        harvestAfterDays: schema.cropGuides.harvestAfterDays,
        harvestWindowMinDays: schema.cropGuides.harvestWindowMinDays,
        harvestWindowMaxDays: schema.cropGuides.harvestWindowMaxDays,
        commonPests: schema.cropGuides.commonPests,
      })
      .from(schema.crops)
      .leftJoin(schema.cropGuides, eq(schema.cropGuides.cropId, schema.crops.id))
      .where(eq(schema.crops.id, planting.cropId))
      .limit(1);
    if (rows.length > 0) {
      const row = rows[0];
      const hasWindow =
        row.harvestWindowMinDays != null &&
        row.harvestWindowMaxDays != null &&
        row.harvestWindowMinDays < row.harvestWindowMaxDays;
      guide = {
        family: row.family,
        harvestAfterDays: row.harvestAfterDays,
        harvestWindow: hasWindow
          ? { min: row.harvestWindowMinDays as number, max: row.harvestWindowMaxDays as number }
          : null,
        commonPests: parsePests(row.commonPests),
      };
    }
  }

  let placeKind: string | null = null;
  if (planting.placeId) {
    const rows = await db
      .select({ kind: schema.places.kind })
      .from(schema.places)
      .where(eq(schema.places.id, planting.placeId))
      .limit(1);
    placeKind = rows[0]?.kind ?? null;
  }

  const logs = await db
    .select({ kind: schema.careLogs.kind, loggedAt: schema.careLogs.loggedAt })
    .from(schema.careLogs)
    .where(eq(schema.careLogs.plantingId, planting.id))
    .orderBy(desc(schema.careLogs.loggedAt))
    .limit(RECENT_CARE_LOG_COUNT);

  const recentCareLogs = logs.map((log) => {
    const at = new Date(log.loggedAt).getTime();
    const daysAgo = Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
    return { kind: log.kind as CareLogKind, daysAgo };
  });

  return buildConsultContext({ planting, placeKind, guide, recentCareLogs, now });
}

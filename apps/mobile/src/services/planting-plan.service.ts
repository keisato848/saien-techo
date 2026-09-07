/**
 * 作付け計画サービス — R25 / WBS 4.7（#38）
 *
 * 「来年の春に何を植えるか」を先に決めておき、時期が来たら栽培に変える。
 * 紙の年間栽培計画表のデジタル版（docs/ペルソナ・競合分析.md §4）。
 *
 * ## 年 + 月で持つ理由
 *
 * 計画を立てる時点で日にちは決まらない。判断材料の栽培暦（crop_calendars）も
 * 月単位でしか持っていないので、日まで入れさせると「決まっていないことを
 * 決めさせる」うえに、根拠の無い精度で催促することになる。
 * 実際の植え付け日は、栽培に変換したときに初めて確定する。
 *
 * ## 変換しても計画は消さない
 *
 * 消すと「今年は何を植えるつもりだったか」が年内に溶けてなくなる。
 * plantingId を紐づけて「植えた」側に移す（R25 の「予定と実績」）。
 *
 * ## 作物名を正とする
 *
 * planting.service の createPlanting と同じく resolveCropId で寄せる。
 * 画面から渡された cropId は信用しない — 名前だけ書き換えたときに
 * 別作物の暦で「植えどき」を出す不整合が起きるため（crop-match.service）。
 *
 * web/mock 経路は持たない。テストは実 SQLite（src/test-support/sqlite-test-db.ts）。
 */
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { resolveCropId } from './crop-match.service';
import { getCropGuideDetail } from './crop-guide.service';
import { createPlanting } from './planting.service';
import type { PlantedAs } from './types';

const FAMILY_ID = 'family-001';

/** 予定の種類。crop_calendars.kind の sow / plant と同じ語彙 */
export const PLAN_KINDS = ['sow', 'plant'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  sow: '種まき',
  plant: '植え付け',
};

/**
 * 予定の種類 → 栽培の「種から / 苗から」。
 * 種まきの計画は種から、植え付けの計画は苗から始めるのが普通なので既定にする
 * （変換の確認画面で変えられる）。
 */
export const PLAN_KIND_TO_PLANTED_AS: Record<PlanKind, PlantedAs> = {
  sow: 'seed',
  plant: 'seedling',
};

export interface PlantingPlanItem {
  id: string;
  cropId: string | null;
  cropName: string;
  cropNameReading: string | null;
  variety: string | null;
  placeId: string | null;
  placeName: string | null;
  plannedYear: number;
  /** 1〜12 */
  plannedMonth: number;
  plannedKind: PlanKind;
  note: string | null;
  /** 実績。変換済みなら栽培の id */
  plantingId: string | null;
  convertedAt: string | null;
  /** 予定月まであと何か月か。0 = 今月、負 = 過ぎている */
  monthsUntil: number;
}

export interface SavePlantingPlanInput {
  cropName: string;
  variety?: string | null;
  placeId?: string | null;
  plannedYear: number;
  plannedMonth: number;
  plannedKind: PlanKind;
  note?: string | null;
}

/** 作物の暦から出す「植えどき」の候補。フォームのワンタップ用 */
export interface PlanMonthSuggestion {
  kind: PlanKind;
  startMonth: number;
  endMonth: number;
  /** 窓の開始月が次に来る年 */
  year: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asPlanKind(value: string): PlanKind {
  return (PLAN_KINDS as readonly string[]).includes(value) ? (value as PlanKind) : 'plant';
}

/**
 * 予定月まであと何か月か。0 = 今月、負 = 過ぎている。
 *
 * 純関数にしているのは、年またぎ（12 月 → 翌 1 月）の境界ずれが
 * 画面を眺めていても気づけないため。garden-work の isMonthInWindow と同じ考え方。
 */
export function monthsUntilPlanned(
  plannedYear: number,
  plannedMonth: number,
  now: Date = new Date(),
): number {
  return (plannedYear - now.getFullYear()) * 12 + (plannedMonth - (now.getMonth() + 1));
}

/**
 * 窓の開始月が「次に来る」年。今月がその月なら今年。
 * 暦の窓（4〜5 月）を計画に写すときに、去年の 4 月を提案しないための足し算。
 */
export function nextYearForMonth(month: number, now: Date = new Date()): number {
  return month >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1;
}

/** 「3月」「2027年3月」。同じ年なら年を省く（一覧が読みやすくなる） */
export function formatPlannedMonth(
  plannedYear: number,
  plannedMonth: number,
  now: Date = new Date(),
): string {
  return plannedYear === now.getFullYear()
    ? `${plannedMonth}月`
    : `${plannedYear}年${plannedMonth}月`;
}

export type PlanTiming = 'past' | 'now' | 'soon' | 'later';

/**
 * 一覧に出す時期の目安。
 *
 * **断定しない。** 暦は地域帯 3 区分の目安でしかないので「今が適期です」とは
 * 言わず、「予定の月です」と、利用者が自分で決めたことを返す言い方にする。
 */
export function planTiming(monthsUntil: number): PlanTiming {
  if (monthsUntil < 0) return 'past';
  if (monthsUntil === 0) return 'now';
  if (monthsUntil === 1) return 'soon';
  return 'later';
}

export function planTimingLabel(monthsUntil: number): string {
  switch (planTiming(monthsUntil)) {
    case 'past':
      return '予定の月を過ぎています';
    case 'now':
      return '今月が予定';
    case 'soon':
      return '来月が予定';
    default:
      return `あと${monthsUntil}か月`;
  }
}

const SELECT_COLUMNS = {
  id: schema.plantingPlans.id,
  cropId: schema.plantingPlans.cropId,
  cropName: schema.plantingPlans.cropName,
  cropNameReading: schema.plantingPlans.cropNameReading,
  variety: schema.plantingPlans.variety,
  placeId: schema.plantingPlans.placeId,
  placeName: schema.places.name,
  plannedYear: schema.plantingPlans.plannedYear,
  plannedMonth: schema.plantingPlans.plannedMonth,
  plannedKind: schema.plantingPlans.plannedKind,
  note: schema.plantingPlans.note,
  plantingId: schema.plantingPlans.plantingId,
  convertedAt: schema.plantingPlans.convertedAt,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any, now: Date): PlantingPlanItem {
  return {
    id: row.id,
    cropId: row.cropId,
    cropName: row.cropName,
    cropNameReading: row.cropNameReading,
    variety: row.variety,
    placeId: row.placeId,
    placeName: row.placeName ?? null,
    plannedYear: row.plannedYear,
    plannedMonth: row.plannedMonth,
    plannedKind: asPlanKind(row.plannedKind),
    note: row.note,
    plantingId: row.plantingId,
    convertedAt: row.convertedAt,
    monthsUntil: monthsUntilPlanned(row.plannedYear, row.plannedMonth, now),
  };
}

export interface PlantingPlanListOptions {
  /** true = 栽培に変換済みのものだけ（「植えた」タブ） */
  onlyConverted?: boolean;
}

/**
 * 計画の一覧。既定はまだ植えていないものだけ、予定が近い順。
 *
 * 済みを既定で混ぜないのは、この一覧の用途が「次に何をするか」だから。
 * 変換済みは onlyConverted で別タブに出す（記録としては消さない）。
 */
export async function getPlantingPlans(
  options: PlantingPlanListOptions = {},
  now: Date = new Date(),
): Promise<PlantingPlanItem[]> {
  if (!isNativePlatform) return [];

  const rows = await getDb()
    .select(SELECT_COLUMNS)
    .from(schema.plantingPlans)
    .leftJoin(schema.places, eq(schema.plantingPlans.placeId, schema.places.id))
    .where(
      and(
        eq(schema.plantingPlans.familyId, FAMILY_ID),
        options.onlyConverted
          ? isNotNull(schema.plantingPlans.plantingId)
          : isNull(schema.plantingPlans.plantingId),
      ),
    )
    .orderBy(
      asc(schema.plantingPlans.plannedYear),
      asc(schema.plantingPlans.plannedMonth),
      asc(schema.plantingPlans.cropNameReading),
      asc(schema.plantingPlans.cropName),
    );

  return rows.map((row) => toItem(row, now));
}

export async function getPlantingPlan(
  planId: string,
  now: Date = new Date(),
): Promise<PlantingPlanItem | null> {
  if (!isNativePlatform) return null;

  const rows = await getDb()
    .select(SELECT_COLUMNS)
    .from(schema.plantingPlans)
    .leftJoin(schema.places, eq(schema.plantingPlans.placeId, schema.places.id))
    .where(eq(schema.plantingPlans.id, planId))
    .limit(1);

  return rows.length > 0 ? toItem(rows[0], now) : null;
}

/**
 * 時期が近い計画（今月・来月、および過ぎたもの）。
 *
 * ホームのカードや予定通知の材料。**過ぎたものを外さない** — 忘れたまま
 * 消えるのが一番困る。並びは古い順なので、過ぎたものが先頭に来る。
 */
export async function getUpcomingPlans(now: Date = new Date()): Promise<PlantingPlanItem[]> {
  const plans = await getPlantingPlans({}, now);
  return plans.filter((plan) => plan.monthsUntil <= 1);
}

export async function createPlantingPlan(input: SavePlantingPlanInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('作付け計画の登録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const matched = await resolveCropId(input.cropName);
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.plantingPlans).values({
    id,
    familyId: FAMILY_ID,
    cropId: matched.cropId,
    cropName: input.cropName.trim(),
    cropNameReading: matched.cropNameReading,
    variety: emptyToNull(input.variety),
    placeId: input.placeId ?? null,
    plannedYear: input.plannedYear,
    plannedMonth: input.plannedMonth,
    plannedKind: input.plannedKind,
    note: emptyToNull(input.note),
    plantingId: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function updatePlantingPlan(
  planId: string,
  input: SavePlantingPlanInput,
): Promise<void> {
  if (!isNativePlatform) return;

  // 名前を正として引き直す。付いていた cropId を素通しすると、
  // 「トマト」を「ナス」に直しても crop-tomato が残る（crop-match.service）
  const matched = await resolveCropId(input.cropName);

  await getDb()
    .update(schema.plantingPlans)
    .set({
      cropId: matched.cropId,
      cropName: input.cropName.trim(),
      cropNameReading: matched.cropNameReading,
      variety: emptyToNull(input.variety),
      placeId: input.placeId ?? null,
      plannedYear: input.plannedYear,
      plannedMonth: input.plannedMonth,
      plannedKind: input.plannedKind,
      note: emptyToNull(input.note),
      updatedAt: nowIso(),
    })
    .where(eq(schema.plantingPlans.id, planId));
}

/**
 * 計画を消す。
 *
 * 場所（place.service）と違ってアーカイブは用意しない — 計画は「やめた」で
 * 消えるのが自然で、残しておく価値のある記録にはまだなっていない。
 * 植えたあとの計画は plantingId が付いて「植えた」側に残るので、
 * 記録が失われるのは「植える前にやめた」ときだけになる。
 */
export async function deletePlantingPlan(planId: string): Promise<void> {
  if (!isNativePlatform) return;
  await getDb().delete(schema.plantingPlans).where(eq(schema.plantingPlans.id, planId));
}

export interface ConvertPlanOptions {
  /** 実際に植えた日。既定は今日 */
  plantedOn?: string;
  plantedAs?: PlantedAs;
}

/**
 * 計画 → 栽培へのワンタップ変換（R25）。
 *
 * 作物名・品種・場所・メモを引き継いで栽培を作り、計画に実績を紐づける。
 * **植え付け日は「今日」**。予定の年月は月までしか無く、そこから日付を
 * でっち上げると経過日数がずれて「次の作業」（R10）の目安まで狂う。
 * 実際に植えた日は変換した日と考えるのが一番ずれない。
 *
 * **2 度押しで栽培が 2 つできないよう冪等にする。** 既に変換済みなら
 * 何もせず既存の栽培 id を返す（一覧の行を続けて叩けてしまうため）。
 *
 * @returns 作られた（または既にある）栽培の id
 */
export async function convertPlanToPlanting(
  planId: string,
  options: ConvertPlanOptions = {},
): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('栽培の登録は端末（iOS/Android）でのみ利用できます');
  }

  const plan = await getPlantingPlan(planId);
  if (!plan) throw new Error('計画が見つかりませんでした');
  if (plan.plantingId) return plan.plantingId;

  const plantingId = await createPlanting({
    cropName: plan.cropName,
    cropNameReading: plan.cropNameReading ?? undefined,
    cropId: plan.cropId,
    variety: plan.variety ?? undefined,
    placeId: plan.placeId,
    plantedOn: options.plantedOn ?? nowIso(),
    plantedAs: options.plantedAs ?? PLAN_KIND_TO_PLANTED_AS[plan.plannedKind],
    coverPhotoPath: null,
    note: plan.note ?? undefined,
    tags: [],
  });

  const now = nowIso();
  await getDb()
    .update(schema.plantingPlans)
    .set({ plantingId, convertedAt: now, updatedAt: now })
    .where(eq(schema.plantingPlans.id, planId));

  return plantingId;
}

/**
 * 作物マスターの暦から「いつが予定にできるか」の候補を出す（WBS 4.19 の暦を読む側）。
 *
 * 地域帯は設定済みのものを使う（crop-guide.service が引く）。収穫の窓は
 * 予定には要らないので落とす。候補が無い＝マスターに無い作物なので、
 * フォームは月を手で選ばせる側に倒す。
 */
export async function getPlanMonthSuggestions(
  cropName: string,
  now: Date = new Date(),
): Promise<PlanMonthSuggestion[]> {
  if (!isNativePlatform) return [];

  const matched = await resolveCropId(cropName);
  if (!matched.cropId) return [];

  const detail = await getCropGuideDetail(matched.cropId);
  if (!detail) return [];

  return detail.calendars
    .filter((row): row is { kind: PlanKind; startMonth: number; endMonth: number } =>
      (PLAN_KINDS as readonly string[]).includes(row.kind),
    )
    .map((row) => ({
      kind: row.kind,
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      year: nextYearForMonth(row.startMonth, now),
    }));
}

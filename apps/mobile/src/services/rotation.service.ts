/**
 * 連作障害チェック — R17 / WBS 4.5
 *
 * 「この場所に、この作物を植えて大丈夫か」を登録・編集のフォームの横で答える。
 * 4.19 で作物マスターに入った `crops.family`（科）と
 * `crop_guides.rotation_years`（あける年数）の最初の読み手。
 *
 * ## 止めない
 *
 * 判定に当たっても**保存は妨げない**。家庭菜園の区画は限られていて、
 * 「ナス科は 4 年あける」を守れる人はほとんどいない。禁止すると
 * 「アプリが怒るから場所を未設定にする」になり、場所（R02）の記録ごと壊れる。
 * 伝えるのは「去年ここで何を育てたか」という**事実**と、「何年あけるのが目安か」だけ。
 *
 * ## 何年前かを暦年で数える理由
 *
 * 「4 年あける」は日数ではなく作付けの回数で語られる慣習で、利用者も
 * 「去年」「一昨年」で思い出す。365 日で割ると 11 か月前が「0 年前」になり、
 * 「今年も同じ場所」と言えなくなる。暦年の差で数えて「今年 / 去年 / N年前」を出す。
 *
 * ## 見えない履歴
 *
 * - **場所が未設定の栽培は判定に入らない**（どこに植えたか分からないため）。
 *   これから植える側の場所が未設定なら、そもそも何も出さない
 * - **cropId が付いていない自由入力の栽培も入らない**（科が分からない）。
 *   起動時の backfillPlantingCropIds（crop-match.service）で大半は埋まる
 *
 * どちらも「警告が出ない」側に倒れる。間違った警告より、出ない方がまし。
 */
import { and, eq, ne } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { resolveCropId } from './crop-match.service';

/** 同じ場所で育てた（育てている）同科の 1 件 */
export interface RotationHistoryEntry {
  plantingId: string;
  cropName: string;
  plantedOn: string;
  endedAt: string | null;
  /** まだ育成中か。育成中は「いま」として扱う */
  growing: boolean;
  /** 何年前に育て終えたか（暦年の差）。今年・育成中は 0 */
  yearsAgo: number;
}

export interface RotationWarning {
  /** これから植える作物の名前（マスターの正式名ではなく利用者の入力どおり） */
  cropName: string;
  /** 科。ナス科・ウリ科など */
  family: string;
  /** あける年数の目安 */
  rotationYears: number;
  placeName: string;
  /** 同科の履歴。新しい順。最大 HISTORY_LIMIT 件 */
  history: RotationHistoryEntry[];
}

export interface RotationCheckInput {
  cropName: string;
  placeId: string | null;
  /** これから植える日（ISO 8601） */
  plantedOn: string;
  /** 編集中の栽培。自分自身を履歴から外す */
  excludePlantingId?: string;
}

/** 履歴に並べる件数。3 件も出せば「この区画は同じ科ばかり」は伝わる */
const HISTORY_LIMIT = 3;

/**
 * 暦年の差。基準日が植え付け日より後（さかのぼって登録した場合）は 0 に丸める。
 * 純関数にしているのは、年またぎの数え方が画面を眺めても検証できないため。
 */
export function yearsBetween(referenceIso: string, plantedOnIso: string): number {
  const reference = new Date(referenceIso);
  const planted = new Date(plantedOnIso);
  if (Number.isNaN(reference.getTime()) || Number.isNaN(planted.getTime())) return 0;
  return Math.max(0, planted.getFullYear() - reference.getFullYear());
}

/** 「いま」「今年」「去年」「3年前」。文中に埋める前提の短い語 */
export function rotationTimingLabel(entry: RotationHistoryEntry): string {
  if (entry.growing) return 'いま';
  if (entry.yearsAgo === 0) return '今年';
  if (entry.yearsAgo === 1) return '去年';
  return `${entry.yearsAgo}年前`;
}

/**
 * 警告の 1 文。カードの本文と読み上げラベルの両方で使う。
 * 「南の畝では去年ナス（ナス科）を育てました。トマトは4年あけるのが目安です。」
 */
export function describeRotationWarning(warning: RotationWarning): string {
  const latest = warning.history[0];
  const timing = rotationTimingLabel(latest);
  // 育成中は「育てています」、終わった株は「育てました」。時制がずれると
  // 「去年育てています」のような読みにくい文になる
  const verb = latest.growing ? '育てています' : '育てました';
  return (
    `${warning.placeName}では${timing}${latest.cropName}（${warning.family}）を${verb}。` +
    `${warning.cropName}は${warning.rotationYears}年あけるのが目安です。`
  );
}

/**
 * これから植える作物と場所を突き合わせる。当たらなければ null。
 *
 * null を返すのは次のいずれか — いずれも「判定できない」であって「安全」ではない:
 * 場所が未設定 / 作物がマスターに無い / 科かあける年数がマスターに無い /
 * あける年数が 0（連作しても出にくい作物） / 同科の履歴が無い。
 */
export async function checkRotation(input: RotationCheckInput): Promise<RotationWarning | null> {
  if (!isNativePlatform) return null;

  const cropName = input.cropName.trim();
  const placeId = input.placeId;
  if (!cropName || !placeId) return null;

  const { cropId } = await resolveCropId(cropName);
  if (!cropId) return null;

  const db = getDb();

  const cropRows = await db
    .select({
      family: schema.crops.family,
      rotationYears: schema.cropGuides.rotationYears,
    })
    .from(schema.crops)
    .innerJoin(schema.cropGuides, eq(schema.cropGuides.cropId, schema.crops.id))
    .where(eq(schema.crops.id, cropId))
    .limit(1);

  const family = cropRows[0]?.family ?? null;
  const rotationYears = cropRows[0]?.rotationYears ?? null;
  // 0 は「連作障害が出にくい」というマスターの明示的な判断（タマネギ・カボチャなど）。
  // null は古い端末で列がまだ埋まっていない状態。どちらも黙って通す
  if (!family || rotationYears == null || rotationYears <= 0) return null;

  const placeRows = await db
    .select({ name: schema.places.name })
    .from(schema.places)
    .where(eq(schema.places.id, placeId))
    .limit(1);
  const placeName = placeRows[0]?.name;
  if (!placeName) return null;

  const conditions = [eq(schema.plantings.placeId, placeId), eq(schema.crops.family, family)];
  if (input.excludePlantingId) {
    conditions.push(ne(schema.plantings.id, input.excludePlantingId));
  }

  const rows = await db
    .select({
      id: schema.plantings.id,
      cropName: schema.plantings.cropName,
      plantedOn: schema.plantings.plantedOn,
      endedAt: schema.plantings.endedAt,
    })
    .from(schema.plantings)
    .innerJoin(schema.crops, eq(schema.plantings.cropId, schema.crops.id))
    .where(and(...conditions));

  const history: RotationHistoryEntry[] = [];
  for (const row of rows as {
    id: string;
    cropName: string;
    plantedOn: string;
    endedAt: string | null;
  }[]) {
    const growing = row.endedAt == null;
    // 「あける」年数は片付けた日から数える。育成中の株は場所を占めたままなので
    // 何年前に植えたかに関わらず「いま」（多年草のイチゴやミョウガがこれに当たる）
    const yearsAgo = growing ? 0 : yearsBetween(row.endedAt as string, input.plantedOn);
    if (yearsAgo >= rotationYears) continue;
    history.push({
      plantingId: row.id,
      cropName: row.cropName,
      plantedOn: row.plantedOn,
      endedAt: row.endedAt,
      growing,
      yearsAgo,
    });
  }

  if (history.length === 0) return null;

  history.sort(
    (a, b) =>
      // 育成中を先頭に。次に新しいものから
      Number(b.growing) - Number(a.growing) ||
      a.yearsAgo - b.yearsAgo ||
      b.plantedOn.localeCompare(a.plantedOn),
  );

  return {
    cropName,
    family,
    rotationYears,
    placeName,
    history: history.slice(0, HISTORY_LIMIT),
  };
}

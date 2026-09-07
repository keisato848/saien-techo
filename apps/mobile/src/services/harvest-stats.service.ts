/**
 * 収穫統計・年間サマリー — R18 / WBS 4.6（#32）
 *
 * ## 何を数えるか
 *
 * **数量は任意入力**（R06）。写真だけの収穫が普通にあるので、
 * 「合計いくつ採れたか」は多くの家庭菜園では出せない。
 * そこで **主役は「何回採れたか」（件数）** にした — 件数は数量が無くても
 * 数えられるので、どの記録の付け方でも必ず何かが出る。
 * 数量はそのうえに重ねる（「数量のある N 件だけ合計しています」と断る）。
 *
 * ## 単位をまたいで足さない
 *
 * piece / g / kg / bunch / plant が混ざる。「5 個 + 200g」は 1 つの数にできない。
 * `getHarvestTotals`（harvest.service）と同じく **作物 × 単位**で分けて持つ。
 * 作物をまたいだ合計も出さない — 「トマト 5 個 + ナス 3 個 = 8 個」は
 * 数としては足せても、意味のある数字ではない。
 *
 * ## 年の区切りは端末のタイムゾーン
 *
 * `harvested_at` は UTC の ISO 文字列。`toISOString()` の日付で年月を決めると、
 * 元日や月初 0 時台の記録が前年・前月に落ちる。`groupByMonth`（harvest.service）
 * と同じくローカル時刻で判定する。
 *
 * ## 集計は純関数
 *
 * DB から読むのは `getHarvestStatRows` だけで、集計（`summarizeHarvestYear` /
 * `listHarvestYears`）は行の配列を受け取る純関数にしてある。年またぎ・
 * 単位混在・写真の選び方といった判断はすべてそちら側で、DB 無しで検証できる。
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { HARVEST_UNITS } from './harvest.service';
import { resolvePhotoUri } from './photo-path';
import type { HarvestTotal, HarvestUnit } from './types';

/**
 * ふりかえりに並べる写真の上限。
 * 12 ＝ 1 年を月ごとに 1 枚見返せる数。これ以上並べるとアルバムの劣化版になる
 * （全部見たいときはアルバムへ行けばよい）。
 */
export const MAX_HIGHLIGHT_PHOTOS = 12;

// ─── 型 ──────────────────────────────────────────────────────────────────────

/** 集計の材料になる収穫 1 件。写真は代表 1 枚だけ持つ（統計に全部は要らない） */
export interface HarvestStatRow {
  harvestId: string;
  plantingId: string;
  cropName: string;
  harvestedAt: string;
  quantity: number | null;
  unit: HarvestUnit | null;
  photoUri: string | null;
  photoCount: number;
}

/** 月ごとの収穫。数量ではなく**件数**が主。1〜12 月ぶんすべて返す（0 の月も） */
export interface HarvestMonthStat {
  /** 1〜12 */
  month: number;
  /** 収穫の件数（数量が無くても数える） */
  count: number;
  /** そのうち数量が入っていた件数 */
  quantifiedCount: number;
}

/** 作物ごとの成績。ランキングの 1 行 */
export interface HarvestCropStat {
  cropName: string;
  count: number;
  quantifiedCount: number;
  /** 単位ごとの合計。数量のある収穫だけ。1 件も無ければ空配列 */
  totals: HarvestTotal[];
  /** この作物の、その年の初収穫 */
  firstHarvestedAt: string;
  lastHarvestedAt: string;
  /** 長さ 12。index 0 が 1 月。月別の収穫回数 */
  monthCounts: number[];
  /** 代表写真。**その年でいちばん新しい写真**を使う（育ちきった姿が写る） */
  photoUri: string | null;
}

/** ふりかえりに並べる 1 枚 */
export interface HarvestHighlight {
  harvestId: string;
  plantingId: string;
  cropName: string;
  harvestedAt: string;
  photoUri: string;
}

/** その年の初収穫。「今年いちばん最初に採れたもの」を見せる */
export interface FirstHarvest {
  harvestId: string;
  plantingId: string;
  cropName: string;
  harvestedAt: string;
}

export interface HarvestYearSummary {
  year: number;
  /** 収穫の件数。**数量が無くても数える**ので、これが 0 のときだけ「収穫なし」 */
  count: number;
  /** そのうち数量が入っていた件数。0 なら合計は一切出せない */
  quantifiedCount: number;
  /** 作物の種類数 */
  cropCount: number;
  /** 写真の枚数（1 件で複数枚撮っていればその数だけ） */
  photoCount: number;
  firstHarvest: FirstHarvest | null;
  /** 長さ 12。1〜12 月ぶん */
  months: HarvestMonthStat[];
  /** 件数の多い順。同数なら初収穫の早い順 → 名前順 */
  crops: HarvestCropStat[];
  /** 月ごとに散らした写真。最大 MAX_HIGHLIGHT_PHOTOS 枚、古い順 */
  highlights: HarvestHighlight[];
}

// ─── ローカル時刻の年月 ──────────────────────────────────────────────────────

function localYear(iso: string): number {
  return new Date(iso).getFullYear();
}

/** 1〜12 */
function localMonth(iso: string): number {
  return new Date(iso).getMonth() + 1;
}

/**
 * 小数の合計は誤差が出る（0.1 + 0.2 = 0.30000000000000004）。
 * 収穫の数量は「1.5kg」程度の粒度なので小数 2 桁で丸める。
 */
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── 集計（純関数）───────────────────────────────────────────────────────────

/** 収穫のあった年を新しい順に返す */
export function listHarvestYears(dates: string[]): number[] {
  const years = new Set<number>();
  for (const iso of dates) years.add(localYear(iso));
  return [...years].sort((a, b) => b - a);
}

function emptyMonths(): HarvestMonthStat[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    count: 0,
    quantifiedCount: 0,
  }));
}

export function createEmptyYearSummary(year: number): HarvestYearSummary {
  return {
    year,
    count: 0,
    quantifiedCount: 0,
    cropCount: 0,
    photoCount: 0,
    firstHarvest: null,
    months: emptyMonths(),
    crops: [],
    highlights: [],
  };
}

interface CropAccumulator {
  cropName: string;
  count: number;
  quantifiedCount: number;
  byUnit: Map<HarvestUnit, number>;
  firstHarvestedAt: string;
  lastHarvestedAt: string;
  monthCounts: number[];
  photoUri: string | null;
}

/**
 * 写真を月ごとに散らして選ぶ。
 *
 * 単純に新しい順で上から取ると、**豊作だった 1 か月の写真だけ**が並んで
 * 「1 年のふりかえり」にならない。月を 1 周しながら 1 枚ずつ拾い、
 * 埋まらなければ 2 周目で各月の 2 枚目を拾う。
 */
function pickHighlights(rows: HarvestStatRow[]): HarvestHighlight[] {
  const byMonth = new Map<number, HarvestStatRow[]>();
  for (const row of rows) {
    if (!row.photoUri) continue;
    const month = localMonth(row.harvestedAt);
    const list = byMonth.get(month) ?? [];
    list.push(row);
    byMonth.set(month, list);
  }

  const months = [...byMonth.keys()].sort((a, b) => a - b);
  const picked: HarvestStatRow[] = [];
  for (let round = 0; picked.length < MAX_HIGHLIGHT_PHOTOS; round++) {
    let addedInRound = false;
    for (const month of months) {
      const row = (byMonth.get(month) as HarvestStatRow[])[round];
      if (!row) continue;
      picked.push(row);
      addedInRound = true;
      if (picked.length >= MAX_HIGHLIGHT_PHOTOS) break;
    }
    // どの月も出し尽くしたら終わり（無限ループ避け）
    if (!addedInRound) break;
  }

  return picked
    .sort((a, b) => a.harvestedAt.localeCompare(b.harvestedAt))
    .map((row) => ({
      harvestId: row.harvestId,
      plantingId: row.plantingId,
      cropName: row.cropName,
      harvestedAt: row.harvestedAt,
      photoUri: row.photoUri as string,
    }));
}

/**
 * 1 年ぶんに畳む。
 *
 * `rows` は年をまたいで渡してよい（ここでローカル年で絞る）。
 * SQL の範囲指定が UTC 文字列の比較なのに対し、年の境目はローカル時刻で
 * 決めたいので、**最後の判定は必ずここで**行う。
 */
export function summarizeHarvestYear(rows: HarvestStatRow[], year: number): HarvestYearSummary {
  const inYear = rows
    .filter((row) => localYear(row.harvestedAt) === year)
    .sort((a, b) => a.harvestedAt.localeCompare(b.harvestedAt));
  if (inYear.length === 0) return createEmptyYearSummary(year);

  const months = emptyMonths();
  const crops = new Map<string, CropAccumulator>();
  let quantifiedCount = 0;
  let photoCount = 0;

  for (const row of inYear) {
    const quantified = row.quantity != null && row.unit != null;
    if (quantified) quantifiedCount += 1;
    photoCount += row.photoCount;

    const month = months[localMonth(row.harvestedAt) - 1];
    month.count += 1;
    if (quantified) month.quantifiedCount += 1;

    const crop = crops.get(row.cropName) ?? {
      cropName: row.cropName,
      count: 0,
      quantifiedCount: 0,
      byUnit: new Map<HarvestUnit, number>(),
      firstHarvestedAt: row.harvestedAt,
      lastHarvestedAt: row.harvestedAt,
      monthCounts: Array.from({ length: 12 }, () => 0),
      photoUri: null,
    };
    crop.count += 1;
    // inYear は古い順なので、後から来たものほど新しい
    crop.lastHarvestedAt = row.harvestedAt;
    crop.monthCounts[localMonth(row.harvestedAt) - 1] += 1;
    if (quantified) {
      crop.quantifiedCount += 1;
      const unit = row.unit as HarvestUnit;
      crop.byUnit.set(unit, (crop.byUnit.get(unit) ?? 0) + (row.quantity as number));
    }
    // 代表写真は最後に見つかった＝その年でいちばん新しいものを残す
    if (row.photoUri) crop.photoUri = row.photoUri;
    crops.set(row.cropName, crop);
  }

  const first = inYear[0];
  return {
    year,
    count: inYear.length,
    quantifiedCount,
    cropCount: crops.size,
    photoCount,
    firstHarvest: {
      harvestId: first.harvestId,
      plantingId: first.plantingId,
      cropName: first.cropName,
      harvestedAt: first.harvestedAt,
    },
    months,
    crops: [...crops.values()]
      .map((crop) => ({
        cropName: crop.cropName,
        count: crop.count,
        quantifiedCount: crop.quantifiedCount,
        totals: HARVEST_UNITS.filter((unit) => crop.byUnit.has(unit)).map((unit) => ({
          unit,
          quantity: roundQuantity(crop.byUnit.get(unit) as number),
        })),
        firstHarvestedAt: crop.firstHarvestedAt,
        lastHarvestedAt: crop.lastHarvestedAt,
        monthCounts: crop.monthCounts,
        photoUri: crop.photoUri,
      }))
      // 件数が主。同数のときは「先に採れたほう」を上にする（並びが毎回変わらない
      // ことが大事なので、最後は名前で必ず決着させる）
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.firstHarvestedAt.localeCompare(b.firstHarvestedAt) ||
          a.cropName.localeCompare(b.cropName, 'ja'),
      ),
    highlights: pickHighlights(inYear),
  };
}

// ─── DB から読む ─────────────────────────────────────────────────────────────

const PHOTO_OWNER = 'harvest';

function isHarvestUnit(value: string | null): value is HarvestUnit {
  return value !== null && (HARVEST_UNITS as readonly string[]).includes(value);
}

/** 収穫のあった年を新しい順に。1 件も無ければ空配列 */
export async function getHarvestYears(): Promise<number[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db.select({ harvestedAt: schema.harvests.harvestedAt }).from(schema.harvests);
  return listHarvestYears(rows.map((row) => row.harvestedAt));
}

/**
 * ある年ぶんの行を読む。
 *
 * SQL の範囲は**ローカル年の前後 1 日ぶん広く**取る。`harvested_at` は
 * UTC の ISO 文字列なので文字列比較で足りるが、タイムゾーン差や
 * 復元されたバックアップの表記ゆれで境目の 1 件を落としたくない。
 * 正確な年の判定は `summarizeHarvestYear` がローカル時刻でやり直す。
 */
export async function getHarvestStatRows(year: number): Promise<HarvestStatRow[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const from = new Date(year, 0, 1);
  from.setDate(from.getDate() - 1);
  const to = new Date(year + 1, 0, 1);
  to.setDate(to.getDate() + 1);

  const rows = await db
    .select({
      harvestId: schema.harvests.id,
      plantingId: schema.harvests.plantingId,
      cropName: schema.plantings.cropName,
      harvestedAt: schema.harvests.harvestedAt,
      quantity: schema.harvests.quantity,
      unit: schema.harvests.unit,
    })
    .from(schema.harvests)
    .innerJoin(schema.plantings, eq(schema.harvests.plantingId, schema.plantings.id))
    .where(
      and(
        gte(schema.harvests.harvestedAt, from.toISOString()),
        lt(schema.harvests.harvestedAt, to.toISOString()),
      ),
    )
    .orderBy(asc(schema.harvests.harvestedAt));
  if (rows.length === 0) return [];

  const photoRows = await db
    .select({
      ownerId: schema.photos.ownerId,
      localPath: schema.photos.localPath,
      sortOrder: schema.photos.sortOrder,
    })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.ownerType, PHOTO_OWNER),
        inArray(
          schema.photos.ownerId,
          rows.map((row) => row.harvestId),
        ),
      ),
    )
    .orderBy(asc(schema.photos.sortOrder));

  const firstPhoto = new Map<string, string>();
  const photoCounts = new Map<string, number>();
  for (const photo of photoRows) {
    photoCounts.set(photo.ownerId, (photoCounts.get(photo.ownerId) ?? 0) + 1);
    if (!firstPhoto.has(photo.ownerId))
      firstPhoto.set(photo.ownerId, resolvePhotoUri(photo.localPath));
  }

  return rows.map((row) => ({
    harvestId: row.harvestId,
    plantingId: row.plantingId,
    cropName: row.cropName,
    harvestedAt: row.harvestedAt,
    quantity: row.quantity,
    unit: isHarvestUnit(row.unit) ? row.unit : null,
    photoUri: firstPhoto.get(row.harvestId) ?? null,
    photoCount: photoCounts.get(row.harvestId) ?? 0,
  }));
}

/** 画面が呼ぶ入口。1 年ぶんのサマリーを返す */
export async function getHarvestYearSummary(year: number): Promise<HarvestYearSummary> {
  const rows = await getHarvestStatRows(year);
  return summarizeHarvestYear(rows, year);
}

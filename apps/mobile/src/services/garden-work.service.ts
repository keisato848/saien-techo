/**
 * 今月の菜園仕事 — R08 / WBS 3.2
 *
 * 作物マスターの栽培暦（crop_calendars）を地域帯（§9）で引き、
 * 「今月まける・植えられる・採れる」作物をホームのカードに出す。
 *
 * 出すのは**マスターの作物だけ**（id が crop- 始まり）。「あなたのトマトの次の作業」は
 * R10（3.4）の仕事で、ここは「世の中の畑ではいま何をする時期か」を教える側。
 * ただし**並び順**には利用者の栽培を使う（4.19 レビュー 20）— カードは 1 行 6 種で
 * 畳むので、育てている作物が読み仮名順の後ろに落ちると永久に見えない。
 */
import { asc, eq, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { getRegionOrDefault, type Region } from './region.service';

export interface MonthlyWorkCrop {
  cropId: string;
  name: string;
}

/**
 * 並べ替えの材料。カードは 1 行 6 種までに畳むので、**畳んだときに何が残るか**が
 * 表示の質そのものになる（4.19 レビュー 20）。
 */
export interface RankedWorkCrop extends MonthlyWorkCrop {
  /** いま育てている（終了していない栽培の cropId と一致） */
  growing: boolean;
  /** 今月がこの窓の最終月 = 逃すと来年 */
  lastChance: boolean;
  /** 編集者判断（crop_guides.beginner） */
  beginner: boolean;
}

/**
 * 畳んだ 6 種に何を残すか。①育てている ②今月が窓の最終月 ③初心者向け ④読み仮名。
 * 読み仮名順は SQL 側で付いているので、安定ソートで最後の順位になる。
 *
 * 純関数にしているのは、これが「トマトが隠れる」の再発を防ぐ唯一の砦だから —
 * 読み仮名で切ると 9 月の採りどき 20 品目でトマト（10 番目）とナス（11 番目）が
 * 常に畳まれる側に落ちていた。
 */
export function rankMonthlyWorkCrops(crops: readonly RankedWorkCrop[]): MonthlyWorkCrop[] {
  const score = (crop: RankedWorkCrop): number =>
    (crop.growing ? 0 : 4) + (crop.lastChance ? 0 : 2) + (crop.beginner ? 0 : 1);
  return [...crops]
    .sort((a, b) => score(a) - score(b))
    .map(({ cropId, name }) => ({ cropId, name }));
}

export interface MonthlyGardenWork {
  /** 1〜12 */
  month: number;
  region: Region;
  /** まきどき（種まき） */
  sow: MonthlyWorkCrop[];
  /** 植えどき（苗・種芋の植え付け） */
  plant: MonthlyWorkCrop[];
  /** 採りどき（収穫） */
  harvest: MonthlyWorkCrop[];
}

/**
 * month がこの窓に入っているか。年またぎ（start > end。例: 11 月〜翌 2 月）も見る。
 * 純関数にしているのは、月またぎの境界ずれは画面を眺めていても気づけないから。
 */
export function isMonthInWindow(month: number, startMonth: number, endMonth: number): boolean {
  if (month < 1 || month > 12) return false;
  if (startMonth <= endMonth) return month >= startMonth && month <= endMonth;
  return month >= startMonth || month <= endMonth;
}

/**
 * 今月・保存済みの地域帯の菜園仕事。
 * 地域が未設定なら中間地として引く（getRegionOrDefault）。
 */
export async function getMonthlyGardenWork(now: Date = new Date()): Promise<MonthlyGardenWork> {
  const month = now.getMonth() + 1;
  const region = await getRegionOrDefault();

  const empty: MonthlyGardenWork = { month, region, sow: [], plant: [], harvest: [] };
  if (!isNativePlatform) return empty;

  const db = getDb();

  const rows = await db
    .select({
      cropId: schema.cropCalendars.cropId,
      region: schema.cropCalendars.region,
      kind: schema.cropCalendars.kind,
      startMonth: schema.cropCalendars.startMonth,
      endMonth: schema.cropCalendars.endMonth,
      name: schema.crops.name,
      beginner: schema.cropGuides.beginner,
    })
    .from(schema.cropCalendars)
    .innerJoin(schema.crops, eq(schema.cropCalendars.cropId, schema.crops.id))
    .leftJoin(schema.cropGuides, eq(schema.cropCalendars.cropId, schema.cropGuides.cropId))
    .where(like(schema.cropCalendars.cropId, 'crop-%'))
    .orderBy(asc(schema.crops.nameReading));

  // いま育てている作物を先に出すための 1 クエリ（4.19 レビュー 20）
  const growingRows = await db
    .select({ cropId: schema.plantings.cropId })
    .from(schema.plantings)
    .where(isNull(schema.plantings.endedAt));
  const growing = new Set(
    growingRows.map((row) => row.cropId).filter((cropId): cropId is string => cropId != null),
  );

  const byId: Record<'sow' | 'plant' | 'harvest', Map<string, RankedWorkCrop>> = {
    sow: new Map(),
    plant: new Map(),
    harvest: new Map(),
  };
  for (const row of rows) {
    if (row.region !== region) continue;
    if (!isMonthInWindow(month, row.startMonth, row.endMonth)) continue;
    const kind = row.kind as keyof typeof byId;
    if (!(kind in byId)) continue;
    const lastChance = row.endMonth === month;
    const already = byId[kind].get(row.cropId);
    if (already) {
      // 同じ種別の窓が 2 つある作物（春まき・秋まきなど）。どちらかが締切なら締切扱い
      if (lastChance) already.lastChance = true;
      continue;
    }
    const entry: RankedWorkCrop = {
      cropId: row.cropId,
      name: row.name,
      growing: growing.has(row.cropId),
      lastChance,
      beginner: row.beginner === 1,
    };
    byId[kind].set(row.cropId, entry);
  }

  // Map は挿入順を保つので、読み仮名順（SQL）のまま安定ソートに掛けられる
  empty.sow = rankMonthlyWorkCrops([...byId.sow.values()]);
  empty.plant = rankMonthlyWorkCrops([...byId.plant.values()]);
  empty.harvest = rankMonthlyWorkCrops([...byId.harvest.values()]);
  return empty;
}

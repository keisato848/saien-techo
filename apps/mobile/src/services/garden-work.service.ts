/**
 * 今月の菜園仕事 — R08 / WBS 3.2
 *
 * 作物マスターの栽培暦（crop_calendars）を地域帯（§9）で引き、
 * 「今月まける・植えられる・採れる」作物をホームのカードに出す。
 *
 * 対象は**マスターの作物だけ**（id が crop- 始まり）。利用者の栽培には
 * 触れない — 「あなたのトマトの次の作業」は R10（3.4）の仕事で、
 * ここは「世の中の畑ではいま何をする時期か」を教える側。
 */
import { asc, eq, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { getRegionOrDefault, type Region } from './region.service';

export interface MonthlyWorkCrop {
  cropId: string;
  name: string;
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

  const rows = await getDb()
    .select({
      cropId: schema.cropCalendars.cropId,
      region: schema.cropCalendars.region,
      kind: schema.cropCalendars.kind,
      startMonth: schema.cropCalendars.startMonth,
      endMonth: schema.cropCalendars.endMonth,
      name: schema.crops.name,
    })
    .from(schema.cropCalendars)
    .innerJoin(schema.crops, eq(schema.cropCalendars.cropId, schema.crops.id))
    .where(like(schema.cropCalendars.cropId, 'crop-%'))
    .orderBy(asc(schema.crops.nameReading));

  const seen = { sow: new Set<string>(), plant: new Set<string>(), harvest: new Set<string>() };
  for (const row of rows) {
    if (row.region !== region) continue;
    if (!isMonthInWindow(month, row.startMonth, row.endMonth)) continue;
    const kind = row.kind as keyof typeof seen;
    if (!(kind in seen) || seen[kind].has(row.cropId)) continue;
    seen[kind].add(row.cropId);
    empty[kind].push({ cropId: row.cropId, name: row.name });
  }

  return empty;
}

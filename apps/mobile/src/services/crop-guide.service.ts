/**
 * 作物ガイド — R09 / WBS 3.3
 *
 * 30 作物マスター（crops / crop_guides / crop_calendars）を読む側。
 * 一覧は「いま始めどきか」を添えて並べ、詳細は選んだ地域帯の栽培暦と
 * 育て方（株間・日当たり・水やり・追肥・収穫・虫・コツ）を出す。
 *
 * 対象はマスターの作物だけ（id が crop- 始まり）。書き込みは無い —
 * マスターの更新は syncCropMaster（起動時）だけが行う。
 */
import { asc, eq, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { isMonthInWindow } from './garden-work.service';
import { getRegionOrDefault, type Region } from './region.service';

export interface CropGuideListItem {
  cropId: string;
  name: string;
  nameReading: string | null;
  family: string | null;
  /** 今月・選択地域で種まき or 植え付けの窓に入っているか */
  startNow: boolean;
  /** 今月・選択地域で収穫の窓に入っているか */
  harvestNow: boolean;
}

export interface CropCalendarRow {
  kind: 'sow' | 'plant' | 'harvest';
  startMonth: number;
  endMonth: number;
}

export interface CropGuideDetail {
  cropId: string;
  name: string;
  nameReading: string | null;
  family: string | null;
  defaultUnit: string | null;
  region: Region;
  /** 選択地域の窓。sow → plant → harvest、同種は開始月順 */
  calendars: CropCalendarRow[];
  guide: {
    spacingCm: number | null;
    sunlight: 'full' | 'partial' | null;
    wateringNote: string | null;
    fertilizeAfterDays: number | null;
    harvestAfterDays: number | null;
    commonPests: string[];
    tips: string | null;
  } | null;
}

/**
 * 窓の月表示。「8〜9月」「9月」「10月〜翌2月」。
 * 年またぎ（start > end）の見せ方は画面を眺めていても検証できないので純関数にする。
 */
export function formatMonthRange(startMonth: number, endMonth: number): string {
  if (startMonth === endMonth) return `${startMonth}月`;
  if (startMonth < endMonth) return `${startMonth}〜${endMonth}月`;
  return `${startMonth}月〜翌${endMonth}月`;
}

const KIND_ORDER: Record<CropCalendarRow['kind'], number> = { sow: 0, plant: 1, harvest: 2 };

/** ガイドの一覧。読み仮名順。今月の始めどき・採りどきの印つき */
export async function getCropGuideList(now: Date = new Date()): Promise<CropGuideListItem[]> {
  if (!isNativePlatform) return [];

  const month = now.getMonth() + 1;
  const region = await getRegionOrDefault();
  const db = getDb();

  const crops = await db
    .select({
      cropId: schema.crops.id,
      name: schema.crops.name,
      nameReading: schema.crops.nameReading,
      family: schema.crops.family,
    })
    .from(schema.crops)
    .where(like(schema.crops.id, 'crop-%'))
    .orderBy(asc(schema.crops.nameReading));

  const windows = await db
    .select({
      cropId: schema.cropCalendars.cropId,
      region: schema.cropCalendars.region,
      kind: schema.cropCalendars.kind,
      startMonth: schema.cropCalendars.startMonth,
      endMonth: schema.cropCalendars.endMonth,
    })
    .from(schema.cropCalendars)
    .where(like(schema.cropCalendars.cropId, 'crop-%'));

  const inWindowNow = new Map<string, { start: boolean; harvest: boolean }>();
  for (const w of windows) {
    if (w.region !== region) continue;
    if (!isMonthInWindow(month, w.startMonth, w.endMonth)) continue;
    const entry = inWindowNow.get(w.cropId) ?? { start: false, harvest: false };
    if (w.kind === 'harvest') entry.harvest = true;
    else entry.start = true;
    inWindowNow.set(w.cropId, entry);
  }

  // ガイド（crop_guides）が無い作物は一覧にも出さない。開発用サンプルの
  // 作物行だけが残っている端末で、開いても中身の無い詳細に飛ばさないため
  const guides = await db.select({ cropId: schema.cropGuides.cropId }).from(schema.cropGuides);
  const hasGuide = new Set(guides.map((g) => g.cropId));

  return crops
    .filter((crop) => hasGuide.has(crop.cropId))
    .map((crop) => ({
      ...crop,
      startNow: inWindowNow.get(crop.cropId)?.start ?? false,
      harvestNow: inWindowNow.get(crop.cropId)?.harvest ?? false,
    }));
}

/** 1 作物の詳細。選択地域の暦とガイド */
export async function getCropGuideDetail(cropId: string): Promise<CropGuideDetail | null> {
  if (!isNativePlatform) return null;

  const region = await getRegionOrDefault();
  const db = getDb();

  const crops = await db
    .select({
      cropId: schema.crops.id,
      name: schema.crops.name,
      nameReading: schema.crops.nameReading,
      family: schema.crops.family,
      defaultUnit: schema.crops.defaultUnit,
    })
    .from(schema.crops)
    .where(eq(schema.crops.id, cropId))
    .limit(1);
  if (crops.length === 0) return null;

  const windows = await db
    .select({
      region: schema.cropCalendars.region,
      kind: schema.cropCalendars.kind,
      startMonth: schema.cropCalendars.startMonth,
      endMonth: schema.cropCalendars.endMonth,
    })
    .from(schema.cropCalendars)
    .where(eq(schema.cropCalendars.cropId, cropId));

  const calendars = windows
    .filter((w) => w.region === region)
    .map((w) => ({
      kind: w.kind as CropCalendarRow['kind'],
      startMonth: w.startMonth,
      endMonth: w.endMonth,
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.startMonth - b.startMonth);

  const guides = await db
    .select()
    .from(schema.cropGuides)
    .where(eq(schema.cropGuides.cropId, cropId))
    .limit(1);

  let guide: CropGuideDetail['guide'] = null;
  if (guides.length > 0) {
    const row = guides[0];
    let pests: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.commonPests ?? '[]');
      if (Array.isArray(parsed)) pests = parsed.filter((p): p is string => typeof p === 'string');
    } catch {
      // 壊れた JSON は空扱い（ガイド全体は出す）
    }
    guide = {
      spacingCm: row.spacingCm,
      sunlight: row.sunlight === 'full' || row.sunlight === 'partial' ? row.sunlight : null,
      wateringNote: row.wateringNote,
      fertilizeAfterDays: row.fertilizeAfterDays,
      harvestAfterDays: row.harvestAfterDays,
      commonPests: pests,
      tips: row.tips,
    };
  }

  return { ...crops[0], region, calendars, guide };
}

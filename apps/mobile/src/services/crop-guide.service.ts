/**
 * 作物ガイド — R09 / WBS 3.3・4.19
 *
 * 作物マスター（crops / crop_guides / crop_calendars）を読む側。
 * 一覧は「いま始めどきか」と分類・絞り込みの材料を添えて並べ、詳細は選んだ地域帯の
 * 栽培暦と育て方（株間・日当たり・水やり・発芽・定植・追肥・収穫の幅・適温・連作・作業・
 * 虫・コツ）と、その作物の出典を出す。
 *
 * 対象はマスターの作物だけ（id が crop- 始まり）。書き込みは無い —
 * マスターの更新は syncCropMaster（起動時）だけが行う。
 * 出典（sourceIds）は DB に持たず、コードのマスターを id で引く（検討文書 §2 ②）。
 */
import { asc, eq, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import {
  CROP_MASTER_REFERENCES,
  findCropMaster,
  referencesFor,
  type CropCategory,
  type CropReference,
  type CropTask,
} from '../db/crop-master';
import * as schema from '../db/schema';
import { isMonthInWindow } from './garden-work.service';
import { getRegionOrDefault, type Region } from './region.service';

export interface CropGuideListItem {
  cropId: string;
  name: string;
  nameReading: string | null;
  family: string | null;
  /** 一覧のセクション。旧データで null のことがある */
  category: CropCategory | null;
  /** 多年草（翌年から収穫） */
  perennial: boolean;
  /** 編集者判断。一覧の絞り込みにだけ使う */
  beginner: boolean;
  containerOk: boolean;
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
  category: CropCategory | null;
  defaultUnit: string | null;
  region: Region;
  perennial: boolean;
  /** 選択地域の窓。sow → plant → harvest、同種は開始月順 */
  calendars: CropCalendarRow[];
  guide: {
    spacingCm: number | null;
    sunlight: 'full' | 'partial' | null;
    wateringNote: string | null;
    wateringIntervalDays: number | null;
    germinationDays: number | null;
    transplantAfterDays: number | null;
    fertilizeAfterDays: number | null;
    fertilizeIntervalDays: number | null;
    harvestAfterDays: number | null;
    harvestWindow: { min: number; max: number } | null;
    harvestDurationDays: number | null;
    temperature: { germination: [number, number]; growth: [number, number] } | null;
    rotationYears: number | null;
    tasks: CropTask[];
    commonPests: string[];
    tips: string | null;
  } | null;
  editorial: {
    beginner: boolean;
    containerOk: boolean;
    containerDepthCm: number | null;
  } | null;
  /** この作物の出典。マスターに無い作物は全体の一覧 */
  references: CropReference[];
}

const CATEGORIES: readonly string[] = [
  'leaf',
  'root',
  'fruit',
  'bean',
  'tuber',
  'allium',
  'herb',
  'tree',
];

function asCategory(value: string | null): CropCategory | null {
  return value != null && CATEGORIES.includes(value) ? (value as CropCategory) : null;
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
      category: schema.crops.category,
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
  const guides = await db
    .select({
      cropId: schema.cropGuides.cropId,
      perennial: schema.cropGuides.perennial,
      beginner: schema.cropGuides.beginner,
      containerOk: schema.cropGuides.containerOk,
    })
    .from(schema.cropGuides);
  const guideById = new Map(guides.map((g) => [g.cropId, g]));

  return crops
    .filter((crop) => guideById.has(crop.cropId))
    .map((crop) => {
      const guide = guideById.get(crop.cropId);
      return {
        cropId: crop.cropId,
        name: crop.name,
        nameReading: crop.nameReading,
        family: crop.family,
        category: asCategory(crop.category),
        perennial: guide?.perennial === 1,
        beginner: guide?.beginner === 1,
        containerOk: guide?.containerOk === 1,
        startNow: inWindowNow.get(crop.cropId)?.start ?? false,
        harvestNow: inWindowNow.get(crop.cropId)?.harvest ?? false,
      };
    });
}

function parseStringArray(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    // 壊れた JSON は空扱い（ガイド全体は出す）
    return [];
  }
}

function parseTasks(raw: string | null): CropTask[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (task): task is CropTask =>
          task != null &&
          typeof task === 'object' &&
          typeof (task as CropTask).kind === 'string' &&
          typeof (task as CropTask).afterDays === 'number',
      )
      .sort((a, b) => a.afterDays - b.afterDays);
  } catch {
    return [];
  }
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
      category: schema.crops.category,
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
  let editorial: CropGuideDetail['editorial'] = null;
  let perennial = false;
  if (guides.length > 0) {
    const row = guides[0];
    const hasWindow =
      row.harvestWindowMinDays != null &&
      row.harvestWindowMaxDays != null &&
      row.harvestWindowMinDays < row.harvestWindowMaxDays;
    const hasTemperature =
      row.tempGerminationMin != null &&
      row.tempGerminationMax != null &&
      row.tempGrowthMin != null &&
      row.tempGrowthMax != null;
    perennial = row.perennial === 1;
    guide = {
      spacingCm: row.spacingCm,
      sunlight: row.sunlight === 'full' || row.sunlight === 'partial' ? row.sunlight : null,
      wateringNote: row.wateringNote,
      wateringIntervalDays: row.wateringIntervalDays,
      germinationDays: row.germinationDays,
      transplantAfterDays: row.transplantAfterDays,
      fertilizeAfterDays: row.fertilizeAfterDays,
      fertilizeIntervalDays: row.fertilizeIntervalDays,
      harvestAfterDays: row.harvestAfterDays,
      harvestWindow: hasWindow
        ? { min: row.harvestWindowMinDays as number, max: row.harvestWindowMaxDays as number }
        : null,
      harvestDurationDays: row.harvestDurationDays,
      temperature: hasTemperature
        ? {
            germination: [row.tempGerminationMin as number, row.tempGerminationMax as number],
            growth: [row.tempGrowthMin as number, row.tempGrowthMax as number],
          }
        : null,
      rotationYears: row.rotationYears,
      tasks: parseTasks(row.tasks),
      commonPests: parseStringArray(row.commonPests),
      tips: row.tips,
    };
    // 編集者判断は 4.19 の列が入ってから。旧行（全部 null）は「判断なし」として出さない
    editorial =
      row.beginner != null || row.containerOk != null
        ? {
            beginner: row.beginner === 1,
            containerOk: row.containerOk === 1,
            containerDepthCm: row.containerOk === 1 ? row.containerDepthCm : null,
          }
        : null;
  }

  const master = findCropMaster(cropId);
  const references = master ? referencesFor(master.sourceIds) : [...CROP_MASTER_REFERENCES];

  return {
    ...crops[0],
    category: asCategory(crops[0].category),
    region,
    perennial,
    calendars,
    guide,
    editorial,
    references: references.length > 0 ? references : [...CROP_MASTER_REFERENCES],
  };
}

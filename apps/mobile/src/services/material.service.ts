/**
 * 資材サービス — R12 / WBS 2.6
 *
 * 種・肥料・薬剤・土・道具の在庫。だいどこの pantry_items を下敷きにしているが、
 * **カテゴリを必須**にしている点が違う。食材は名前で用途が分かるが、
 * 資材は「アイコ」「８−８−８」のように名前だけでは何か分からないものが多い。
 *
 * 低在庫の通知は 1 日 1 回にまとめる（だいどこの low-stock と同じ方針）。
 * 資材は買い足しのタイミングが「週末にホームセンターへ行くとき」なので、
 * 都度鳴らしても行動につながらない。
 */
import { and, asc, eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import type { MaterialCategory, MaterialItem, SaveMaterialInput } from './types';

const FAMILY_ID = 'family-001';

export const MATERIAL_CATEGORIES = [
  'seed',
  'fertilizer',
  'pesticide',
  'soil',
  'tool',
  'other',
] as const;

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategory, string> = {
  seed: '種・苗',
  fertilizer: '肥料',
  pesticide: '薬剤',
  soil: '土・肥土',
  tool: '道具',
  other: 'その他',
};

function nowIso(): string {
  return new Date().toISOString();
}

function isCategory(value: string): value is MaterialCategory {
  return (MATERIAL_CATEGORIES as readonly string[]).includes(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any): MaterialItem {
  return {
    id: row.id,
    name: row.name,
    category: isCategory(row.category) ? row.category : 'other',
    quantity: row.quantity,
    unit: row.unit,
    lowThreshold: row.lowThreshold,
    note: row.note,
  };
}

const SELECT_COLUMNS = {
  id: schema.materials.id,
  name: schema.materials.name,
  category: schema.materials.category,
  quantity: schema.materials.quantity,
  unit: schema.materials.unit,
  lowThreshold: schema.materials.lowThreshold,
  note: schema.materials.note,
};

/**
 * 資材の一覧。カテゴリ順 → 名前順。
 * 追加順だと「肥料はどこだっけ」が毎回起きるので、種類でまとまる並びにする。
 */
export async function getMaterials(category?: MaterialCategory): Promise<MaterialItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const where = category
    ? and(eq(schema.materials.familyId, FAMILY_ID), eq(schema.materials.category, category))
    : eq(schema.materials.familyId, FAMILY_ID);

  const rows = await db
    .select(SELECT_COLUMNS)
    .from(schema.materials)
    .where(where)
    .orderBy(asc(schema.materials.name));

  const items = rows.map(toItem);
  const order = new Map(MATERIAL_CATEGORIES.map((value, index) => [value, index]));
  return items.sort(
    (a, b) =>
      (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
      a.name.localeCompare(b.name, 'ja'),
  );
}

export async function getMaterial(materialId: string): Promise<MaterialItem | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(schema.materials)
    .where(eq(schema.materials.id, materialId))
    .limit(1);

  return rows.length > 0 ? toItem(rows[0]) : null;
}

export async function createMaterial(input: SaveMaterialInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('資材の登録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.materials).values({
    id,
    familyId: FAMILY_ID,
    name: input.name.trim(),
    category: input.category,
    quantity: input.quantity ?? null,
    // 数量が無いなら単位も閾値も意味を持たない
    unit: input.quantity != null ? input.unit?.trim() || null : null,
    lowThreshold: input.quantity != null ? (input.lowThreshold ?? null) : null,
    janCode: null,
    note: input.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function updateMaterial(materialId: string, input: SaveMaterialInput): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.materials)
    .set({
      name: input.name.trim(),
      category: input.category,
      quantity: input.quantity ?? null,
      unit: input.quantity != null ? input.unit?.trim() || null : null,
      lowThreshold: input.quantity != null ? (input.lowThreshold ?? null) : null,
      note: input.note?.trim() || null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.materials.id, materialId));
}

/**
 * 残量を足し引きする。0 未満にはしない。
 * 「使った」を 1 タップで記録できるようにするための入り口（R12）。
 */
export async function adjustMaterialQuantity(
  materialId: string,
  delta: number,
): Promise<number | null> {
  if (!isNativePlatform) return null;

  const material = await getMaterial(materialId);
  if (!material || material.quantity == null) return null;

  const next = Math.max(0, Math.round((material.quantity + delta) * 100) / 100);
  const db = getDb();
  await db
    .update(schema.materials)
    .set({ quantity: next, updatedAt: nowIso() })
    .where(eq(schema.materials.id, materialId));

  return next;
}

export async function deleteMaterial(materialId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db.delete(schema.materials).where(eq(schema.materials.id, materialId));
}

/**
 * 閾値を下回っているもの。
 * **数量と閾値の両方が入っているものだけ**を対象にする。
 * 片方しか無い資材（道具など）を「残り不明」で鳴らすと、通知が意味を失う。
 */
export function filterLowMaterials(items: MaterialItem[]): MaterialItem[] {
  return items.filter(
    (item) =>
      item.quantity != null && item.lowThreshold != null && item.quantity <= item.lowThreshold,
  );
}

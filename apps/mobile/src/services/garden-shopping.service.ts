/**
 * 買い物リスト — R12 / WBS 2.7
 *
 * だいどこの shopping-list.service を下敷きにしているが、**別テーブル**
 * （garden_shopping_items）を使う。同じ表に載せると、タブから外しただけで
 * 残っている食材の買い物リストと混ざり、菜園のメモに「牛乳」が並ぶ。
 *
 * 「買った」は在庫へ足し戻す。ホームセンターから帰って在庫画面を開き直す人は
 * いないので、チェックした時点で資材の残量に反映させる（R12）。
 */
import { and, asc, eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { normalizeItemName } from '../utils/itemName';
import { adjustMaterialQuantity, filterLowMaterials, getMaterials } from './material.service';
import type { GardenShoppingItem, GardenShoppingSource, MaterialCategory } from './types';

const FAMILY_ID = 'family-001';

const MATERIAL_CATEGORIES: readonly string[] = [
  'seed',
  'fertilizer',
  'pesticide',
  'soil',
  'tool',
  'other',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any): GardenShoppingItem {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    checked: row.checked === 1,
    source: (row.source === 'low' ? 'low' : 'manual') as GardenShoppingSource,
    materialId: row.materialId,
    materialCategory:
      row.materialCategory && MATERIAL_CATEGORIES.includes(row.materialCategory)
        ? (row.materialCategory as MaterialCategory)
        : null,
  };
}

/**
 * 未チェック → チェック済みの順、それぞれ追加順。
 * 買い終わったものを消さずに下へ送るのは、レジ前で「あれ買ったっけ」を
 * 見返せるようにするため。
 */
export async function getGardenShoppingItems(): Promise<GardenShoppingItem[]> {
  if (!isNativePlatform) return [];

  const rows = await getDb()
    .select({
      id: schema.gardenShoppingItems.id,
      name: schema.gardenShoppingItems.name,
      amount: schema.gardenShoppingItems.amount,
      checked: schema.gardenShoppingItems.checked,
      source: schema.gardenShoppingItems.source,
      materialId: schema.gardenShoppingItems.materialId,
      materialCategory: schema.materials.category,
    })
    .from(schema.gardenShoppingItems)
    .leftJoin(schema.materials, eq(schema.gardenShoppingItems.materialId, schema.materials.id))
    .where(eq(schema.gardenShoppingItems.familyId, FAMILY_ID))
    .orderBy(asc(schema.gardenShoppingItems.checked), asc(schema.gardenShoppingItems.createdAt));

  return rows.map(toItem);
}

/**
 * 追加する。**未チェックで同じ名前が既にあるときは足さない**（null を返す）。
 * 「肥料」を 2 回押しても 2 行にならないようにするため。
 * チェック済みの同名は無視する — 買い終わったものをもう一度買うことはある。
 */
export async function addGardenShoppingItem(
  name: string,
  amount?: string,
  options?: { source?: GardenShoppingSource; materialId?: string },
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed || !isNativePlatform) return null;

  const db = getDb();
  const nameNormalized = normalizeItemName(trimmed);

  const existing = await db
    .select({ id: schema.gardenShoppingItems.id })
    .from(schema.gardenShoppingItems)
    .where(
      and(
        eq(schema.gardenShoppingItems.familyId, FAMILY_ID),
        eq(schema.gardenShoppingItems.nameNormalized, nameNormalized),
        eq(schema.gardenShoppingItems.checked, 0),
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;

  const id = generateId();
  await db.insert(schema.gardenShoppingItems).values({
    id,
    familyId: FAMILY_ID,
    name: trimmed,
    nameNormalized,
    amount: amount?.trim() || null,
    checked: 0,
    source: options?.source ?? 'manual',
    materialId: options?.materialId ?? null,
    createdAt: new Date().toISOString(),
    checkedAt: null,
  });

  return id;
}

/**
 * 残りわずかの資材をまとめて追加する。追加した件数を返す。
 * 既に載っているものは飛ばすので、何度押しても増えない。
 */
export async function addLowMaterialsToShoppingList(): Promise<number> {
  if (!isNativePlatform) return 0;

  const low = filterLowMaterials(await getMaterials());
  let added = 0;
  for (const material of low) {
    const id = await addGardenShoppingItem(material.name, undefined, {
      source: 'low',
      materialId: material.id,
    });
    if (id) added += 1;
  }
  return added;
}

/**
 * チェックを付け外しする。
 *
 * 資材に紐づく行に**初めて**チェックを付けたときだけ、在庫を 1 足す。
 * 外して付け直すたびに増えると、レジ前の押し間違いが在庫を壊す。
 * そのため checked_at は「最初にチェックした時刻」= 在庫へ足した目印として扱い、
 * 外しても消さない。
 *
 * 足す量は「量にかかわらず 1」。買い物メモの「2袋」「少し」を数値として
 * 解釈すると、単位が kg の資材に袋数を足すような取り違えが起きる。
 * ずれたぶんは資材一覧の ± で直せる。
 */
export async function setGardenShoppingItemChecked(
  itemId: string,
  checked: boolean,
): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  const rows = await db
    .select({
      checked: schema.gardenShoppingItems.checked,
      checkedAt: schema.gardenShoppingItems.checkedAt,
      materialId: schema.gardenShoppingItems.materialId,
    })
    .from(schema.gardenShoppingItems)
    .where(eq(schema.gardenShoppingItems.id, itemId))
    .limit(1);
  if (rows.length === 0) return;

  const row = rows[0];
  const firstTime = checked && row.checked !== 1 && row.checkedAt == null;

  await db
    .update(schema.gardenShoppingItems)
    .set({
      checked: checked ? 1 : 0,
      checkedAt: checked ? (row.checkedAt ?? new Date().toISOString()) : row.checkedAt,
    })
    .where(eq(schema.gardenShoppingItems.id, itemId));

  if (firstTime && row.materialId) {
    await adjustMaterialQuantity(row.materialId, 1);
  }
}

export async function removeGardenShoppingItem(itemId: string): Promise<void> {
  if (!isNativePlatform) return;

  await getDb().delete(schema.gardenShoppingItems).where(eq(schema.gardenShoppingItems.id, itemId));
}

/** 買い終わったものをまとめて消す */
export async function clearCheckedGardenShoppingItems(): Promise<number> {
  if (!isNativePlatform) return 0;

  const db = getDb();
  const rows = await db
    .select({ id: schema.gardenShoppingItems.id })
    .from(schema.gardenShoppingItems)
    .where(
      and(
        eq(schema.gardenShoppingItems.familyId, FAMILY_ID),
        eq(schema.gardenShoppingItems.checked, 1),
      ),
    );

  await db
    .delete(schema.gardenShoppingItems)
    .where(
      and(
        eq(schema.gardenShoppingItems.familyId, FAMILY_ID),
        eq(schema.gardenShoppingItems.checked, 1),
      ),
    );

  return rows.length;
}

/**
 * 場所（区画）サービス — R02 / WBS 1.6
 *
 * プランター・畝・区画の CRUD。栽培から参照される。
 *
 * 削除は「アーカイブ」を基本にしている。場所を物理削除すると、その場所で
 * 育てた過去の栽培から場所名が消えて記録の価値が落ちるため。
 * 栽培が 1 件も紐づいていない場所だけは物理削除できる（作り間違いの取り消し）。
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import type { PlaceDetail, PlaceItem, SavePlaceInput } from './types';

const FAMILY_ID = 'family-001';

export const PLACE_KINDS = ['planter', 'row', 'plot', 'other'] as const;

export const PLACE_KIND_LABEL: Record<string, string> = {
  planter: 'プランター',
  row: '畝',
  plot: '区画',
  other: 'その他',
};

function nowIso(): string {
  return new Date().toISOString();
}

/** 未アーカイブの場所を並び順で返す。栽培フォームのピッカー用 */
export async function getPlaceList(): Promise<PlaceItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();

  return db
    .select({
      id: schema.places.id,
      name: schema.places.name,
      kind: schema.places.kind,
    })
    .from(schema.places)
    .where(and(eq(schema.places.familyId, FAMILY_ID), isNull(schema.places.archivedAt)))
    .orderBy(asc(schema.places.sortOrder), asc(schema.places.name));
}

/**
 * 管理画面用。アーカイブ済みも含め、各場所に紐づく栽培の件数を添えて返す。
 * 件数を出すのは「消していいか」の判断材料になるため。
 */
export async function getPlaceDetailList(): Promise<PlaceDetail[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.places.id,
      name: schema.places.name,
      kind: schema.places.kind,
      note: schema.places.note,
      sortOrder: schema.places.sortOrder,
      archivedAt: schema.places.archivedAt,
    })
    .from(schema.places)
    .where(eq(schema.places.familyId, FAMILY_ID))
    .orderBy(asc(schema.places.sortOrder), asc(schema.places.name));

  const counts = await db
    .select({
      placeId: schema.plantings.placeId,
      total: sql<number>`count(*)`,
      growing: sql<number>`sum(case when ${schema.plantings.endedAt} is null then 1 else 0 end)`,
    })
    .from(schema.plantings)
    .groupBy(schema.plantings.placeId);

  const byPlace = new Map(counts.map((row) => [row.placeId, row]));

  return rows.map((row) => ({
    ...row,
    plantingCount: Number(byPlace.get(row.id)?.total ?? 0),
    growingCount: Number(byPlace.get(row.id)?.growing ?? 0),
  }));
}

export async function getPlace(placeId: string): Promise<PlaceDetail | null> {
  const all = await getPlaceDetailList();
  return all.find((place) => place.id === placeId) ?? null;
}

export async function createPlace(input: SavePlaceInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('場所の登録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const id = generateId();
  const now = nowIso();

  // 末尾に足す。並べ替えは movePlace で行う
  const existing = await db
    .select({ sortOrder: schema.places.sortOrder })
    .from(schema.places)
    .where(eq(schema.places.familyId, FAMILY_ID));
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), 0) + 1;

  await db.insert(schema.places).values({
    id,
    familyId: FAMILY_ID,
    name: input.name.trim(),
    kind: input.kind,
    note: input.note?.trim() || null,
    sortOrder: nextOrder,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function updatePlace(placeId: string, input: SavePlaceInput): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.places)
    .set({
      name: input.name.trim(),
      kind: input.kind,
      note: input.note?.trim() || null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.places.id, placeId));
}

/** 使わなくなった場所を隠す。過去の栽培からは引き続き参照できる */
export async function archivePlace(placeId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  const now = nowIso();
  await db
    .update(schema.places)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(schema.places.id, placeId));
}

export async function unarchivePlace(placeId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.places)
    .set({ archivedAt: null, updatedAt: nowIso() })
    .where(eq(schema.places.id, placeId));
}

/**
 * 物理削除。栽培が 1 件でも紐づいていたら拒否する。
 * 消すと過去の記録から場所名が失われるため、その場合はアーカイブを使う。
 */
export async function deletePlace(placeId: string): Promise<{ deleted: boolean }> {
  if (!isNativePlatform) return { deleted: false };

  const db = getDb();
  const used = await db
    .select({ id: schema.plantings.id })
    .from(schema.plantings)
    .where(eq(schema.plantings.placeId, placeId))
    .limit(1);
  if (used.length > 0) return { deleted: false };

  await db.delete(schema.places).where(eq(schema.places.id, placeId));
  return { deleted: true };
}

/**
 * 並び替え。上下 1 つ分の入れ替え。
 *
 * ドラッグ＆ドロップにしないのは、場所はたかだか十数件で、
 * 短い行のドラッグは指の太さに対して誤操作が多いため。
 * sort_order が NULL や重複でも成立するよう、毎回 1..n で振り直す。
 */
export async function movePlace(placeId: string, direction: 'up' | 'down'): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  const places = await getPlaceDetailList();
  const index = places.findIndex((place) => place.id === placeId);
  if (index < 0) return;

  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= places.length) return;

  const reordered = [...places];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  const now = nowIso();
  for (let i = 0; i < reordered.length; i++) {
    await db
      .update(schema.places)
      .set({ sortOrder: i + 1, updatedAt: now })
      .where(eq(schema.places.id, reordered[i].id));
  }
}

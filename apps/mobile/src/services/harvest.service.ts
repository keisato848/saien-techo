/**
 * 収穫サービス — R06 / WBS 2.1
 *
 * **写真が主役で、数量は任意。** 「採れた」という事実と見た目が残ることに価値があり、
 * 数を数えさせると記録そのものが止まる（要件 R06 の受け入れ基準）。
 *
 * 作業ログ（care_logs）とは別テーブル。数量・単位を持ち、R07 アルバムと
 * R18 統計の対象になるため（WBS 1.3 の決定 / docs/データ設計.md）。
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { deleteGardenPhotoFiles, MAX_GARDEN_PHOTOS } from './photo-storage.service';
import type { HarvestItem, HarvestTotal, HarvestUnit, SaveHarvestInput } from './types';

const PHOTO_OWNER = 'harvest';

export const HARVEST_UNITS = ['piece', 'g', 'kg', 'bunch', 'plant'] as const;

export const HARVEST_UNIT_LABEL: Record<HarvestUnit, string> = {
  piece: '個',
  g: 'g',
  kg: 'kg',
  bunch: '束',
  plant: '株',
};

function nowIso(): string {
  return new Date().toISOString();
}

function isHarvestUnit(value: string | null): value is HarvestUnit {
  return value !== null && (HARVEST_UNITS as readonly string[]).includes(value);
}

/**
 * その栽培の既定単位。作物マスターに登録があればそれを使う（R06）。
 * トマトなら「個」、バジルなら「束」のように、毎回選ばせない。
 */
export async function getDefaultUnitForPlanting(plantingId: string): Promise<HarvestUnit | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select({ defaultUnit: schema.crops.defaultUnit })
    .from(schema.plantings)
    .innerJoin(schema.crops, eq(schema.plantings.cropId, schema.crops.id))
    .where(eq(schema.plantings.id, plantingId))
    .limit(1);

  const unit = rows[0]?.defaultUnit ?? null;
  return isHarvestUnit(unit) ? unit : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPhotoPaths(db: any, harvestIds: string[]): Promise<Map<string, string[]>> {
  const byHarvest = new Map<string, string[]>();
  if (harvestIds.length === 0) return byHarvest;

  const rows = await db
    .select({
      ownerId: schema.photos.ownerId,
      localPath: schema.photos.localPath,
      sortOrder: schema.photos.sortOrder,
    })
    .from(schema.photos)
    .where(
      and(eq(schema.photos.ownerType, PHOTO_OWNER), inArray(schema.photos.ownerId, harvestIds)),
    );

  const sorted = [...rows].sort(
    (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder,
  );
  for (const row of sorted as { ownerId: string; localPath: string }[]) {
    const list = byHarvest.get(row.ownerId) ?? [];
    list.push(row.localPath);
    byHarvest.set(row.ownerId, list);
  }
  return byHarvest;
}

/** ある栽培の収穫を新しい順に返す */
export async function getHarvests(plantingId: string): Promise<HarvestItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.harvests.id,
      plantingId: schema.harvests.plantingId,
      harvestedAt: schema.harvests.harvestedAt,
      quantity: schema.harvests.quantity,
      unit: schema.harvests.unit,
      note: schema.harvests.note,
    })
    .from(schema.harvests)
    .where(eq(schema.harvests.plantingId, plantingId))
    .orderBy(desc(schema.harvests.harvestedAt));

  const photos = await getPhotoPaths(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    plantingId: row.plantingId,
    harvestedAt: row.harvestedAt,
    quantity: row.quantity,
    unit: isHarvestUnit(row.unit) ? row.unit : null,
    note: row.note,
    photoUris: photos.get(row.id) ?? [],
  }));
}

export async function getHarvest(harvestId: string): Promise<HarvestItem | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.harvests.id,
      plantingId: schema.harvests.plantingId,
      harvestedAt: schema.harvests.harvestedAt,
      quantity: schema.harvests.quantity,
      unit: schema.harvests.unit,
      note: schema.harvests.note,
    })
    .from(schema.harvests)
    .where(eq(schema.harvests.id, harvestId))
    .limit(1);
  if (rows.length === 0) return null;

  const row = rows[0];
  const photos = await getPhotoPaths(db, [harvestId]);
  return {
    id: row.id,
    plantingId: row.plantingId,
    harvestedAt: row.harvestedAt,
    quantity: row.quantity,
    unit: isHarvestUnit(row.unit) ? row.unit : null,
    note: row.note,
    photoUris: photos.get(row.id) ?? [],
  };
}

/**
 * その栽培の合計。**単位ごとに分ける。**
 * 「個」と「g」を足せないので 1 つの数にはまとめられない。
 * 数量が未入力の収穫は合計に入らない（写真だけの記録があるため）。
 */
export async function getHarvestTotals(plantingId: string): Promise<HarvestTotal[]> {
  const harvests = await getHarvests(plantingId);

  const byUnit = new Map<HarvestUnit, number>();
  for (const harvest of harvests) {
    if (harvest.quantity == null || harvest.unit == null) continue;
    byUnit.set(harvest.unit, (byUnit.get(harvest.unit) ?? 0) + harvest.quantity);
  }

  return HARVEST_UNITS.filter((unit) => byUnit.has(unit)).map((unit) => ({
    unit,
    quantity: byUnit.get(unit) as number,
  }));
}

export async function createHarvest(input: SaveHarvestInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('収穫の記録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.harvests).values({
    id,
    plantingId: input.plantingId,
    harvestedAt: input.harvestedAt ?? now,
    // 数量だけ入れて単位を選ばないケースがあるので、片方だけなら両方 NULL にする
    quantity: input.quantity ?? null,
    unit: input.quantity != null ? (input.unit ?? null) : null,
    note: input.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });

  await replacePhotos(db, id, input.photoUris ?? []);
  return id;
}

export async function updateHarvest(
  harvestId: string,
  input: Omit<SaveHarvestInput, 'plantingId'>,
): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.harvests)
    .set({
      harvestedAt: input.harvestedAt ?? nowIso(),
      quantity: input.quantity ?? null,
      unit: input.quantity != null ? (input.unit ?? null) : null,
      note: input.note?.trim() || null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.harvests.id, harvestId));

  await replacePhotos(db, harvestId, input.photoUris ?? []);
}

export async function deleteHarvest(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  const photos = await getPhotoPaths(db, [harvestId]);
  await deleteGardenPhotoFiles(photos.get(harvestId) ?? []);

  await db
    .delete(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), eq(schema.photos.ownerId, harvestId)));
  await db.delete(schema.harvests).where(eq(schema.harvests.id, harvestId));
}

/** care-log.service と同じ方針。外した写真だけ端末のファイルを消す */
async function replacePhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  harvestId: string,
  photoUris: string[],
): Promise<void> {
  if (photoUris.length > MAX_GARDEN_PHOTOS) {
    throw new RangeError(`写真は${MAX_GARDEN_PHOTOS}枚まで追加できます`);
  }

  const before = (await getPhotoPaths(db, [harvestId])).get(harvestId) ?? [];
  await deleteGardenPhotoFiles(before.filter((path) => !photoUris.includes(path)));

  await db
    .delete(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), eq(schema.photos.ownerId, harvestId)));

  const now = nowIso();
  for (let i = 0; i < photoUris.length; i++) {
    await db.insert(schema.photos).values({
      id: generateId(),
      ownerType: PHOTO_OWNER,
      ownerId: harvestId,
      localPath: photoUris[i],
      width: null,
      height: null,
      sortOrder: i + 1,
      createdAt: now,
    });
  }
}

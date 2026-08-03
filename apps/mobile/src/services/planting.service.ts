/**
 * 栽培サービス — R01 の CRUD（WBS 1.5）
 *
 * だいどこの recipe.service.ts が下敷きだが、**リビジョン機構は持たない**。
 * レシピは「作り方を改訂する」ものなので版が要るが、栽培は 1 株 1 レコードで
 * 版という概念がない。作業の履歴は care_logs（WBS 1.8）が受け持つ。
 *
 * web/mock 経路は用意していない。さいえん手帳の対象は Android/iOS のみで、
 * だいどこのようなモック実装を並走させると実 SQL との乖離が入り込むため
 * （テストは実 SQLite に対して実行する — src/test-support/sqlite-test-db.ts）。
 */
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { removePlantingFtsEntry, updatePlantingFtsIndex } from './fts.service';
import type {
  PlantedAs,
  PlantingDetail,
  PlantingEndedReason,
  PlantingListItem,
  SavePlantingInput,
  UpdatePlantingInput,
} from './types';

const FAMILY_ID = 'family-001';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 植え付けからの経過日数。栽培終了後は終了日で止める
 * （終了した株の「300日経過」に意味はなく、栽培期間の方が知りたい情報のため）。
 */
export function elapsedDaysFrom(plantedOn: string, endedAt: string | null): number {
  const start = new Date(plantedOn).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** 栽培一覧。既定は育成中のみ（R03 の切り替えは endedAt で行う） */
export async function getPlantingList(
  options: { includeEnded?: boolean; onlyEnded?: boolean } = {},
): Promise<PlantingListItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();

  const endedFilter = options.onlyEnded
    ? isNotNull(schema.plantings.endedAt)
    : options.includeEnded
      ? undefined
      : isNull(schema.plantings.endedAt);

  const where = endedFilter
    ? and(eq(schema.plantings.familyId, FAMILY_ID), endedFilter)
    : eq(schema.plantings.familyId, FAMILY_ID);

  const rows = await db
    .select({
      id: schema.plantings.id,
      cropName: schema.plantings.cropName,
      variety: schema.plantings.variety,
      placeId: schema.plantings.placeId,
      placeName: schema.places.name,
      plantedOn: schema.plantings.plantedOn,
      plantedAs: schema.plantings.plantedAs,
      coverPhotoPath: schema.plantings.coverPhotoPath,
      endedAt: schema.plantings.endedAt,
      endedReason: schema.plantings.endedReason,
    })
    .from(schema.plantings)
    .leftJoin(schema.places, eq(schema.plantings.placeId, schema.places.id))
    .where(where)
    .orderBy(desc(schema.plantings.plantedOn));

  const result: PlantingListItem[] = [];
  for (const row of rows) {
    result.push({
      id: row.id,
      cropName: row.cropName,
      variety: row.variety,
      placeName: row.placeName ?? null,
      plantedOn: row.plantedOn,
      plantedAs: row.plantedAs as PlantedAs,
      elapsedDays: elapsedDaysFrom(row.plantedOn, row.endedAt),
      tags: await getTagNames(db, schema, row.id),
      coverPhotoUri: row.coverPhotoPath,
      endedAt: row.endedAt,
      endedReason: (row.endedReason as PlantingEndedReason | null) ?? null,
    });
  }
  return result;
}

export async function getPlantingDetail(plantingId: string): Promise<PlantingDetail | null> {
  if (!isNativePlatform) return null;

  const db = getDb();

  const rows = await db
    .select({
      id: schema.plantings.id,
      cropId: schema.plantings.cropId,
      cropName: schema.plantings.cropName,
      cropNameReading: schema.plantings.cropNameReading,
      variety: schema.plantings.variety,
      placeId: schema.plantings.placeId,
      placeName: schema.places.name,
      plantedOn: schema.plantings.plantedOn,
      plantedAs: schema.plantings.plantedAs,
      coverPhotoPath: schema.plantings.coverPhotoPath,
      note: schema.plantings.note,
      endedAt: schema.plantings.endedAt,
      endedReason: schema.plantings.endedReason,
      createdAt: schema.plantings.createdAt,
      updatedAt: schema.plantings.updatedAt,
    })
    .from(schema.plantings)
    .leftJoin(schema.places, eq(schema.plantings.placeId, schema.places.id))
    .where(eq(schema.plantings.id, plantingId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    id: row.id,
    cropId: row.cropId,
    cropName: row.cropName,
    cropNameReading: row.cropNameReading,
    variety: row.variety,
    placeId: row.placeId,
    placeName: row.placeName ?? null,
    plantedOn: row.plantedOn,
    plantedAs: row.plantedAs as PlantedAs,
    elapsedDays: elapsedDaysFrom(row.plantedOn, row.endedAt),
    tags: await getTagNames(db, schema, row.id),
    coverPhotoUri: row.coverPhotoPath,
    note: row.note,
    endedAt: row.endedAt,
    endedReason: (row.endedReason as PlantingEndedReason | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPlanting(input: SavePlantingInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('栽培の登録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();

  const plantingId = generateId();
  const now = nowIso();

  await db.insert(schema.plantings).values({
    id: plantingId,
    familyId: FAMILY_ID,
    cropId: input.cropId ?? null,
    cropName: input.cropName,
    cropNameReading: input.cropNameReading ?? null,
    variety: emptyToNull(input.variety),
    placeId: input.placeId ?? null,
    plantedOn: input.plantedOn,
    plantedAs: input.plantedAs,
    coverPhotoPath: input.coverPhotoPath ?? null,
    note: emptyToNull(input.note),
    endedAt: null,
    endedReason: null,
    createdAt: now,
    updatedAt: now,
  });

  await replaceTags(db, schema, plantingId, input.tags);
  await updatePlantingFtsIndex(
    plantingId,
    input.cropName,
    input.cropNameReading ?? null,
    emptyToNull(input.variety),
    input.tags,
  );

  return plantingId;
}

export async function updatePlanting(
  plantingId: string,
  input: UpdatePlantingInput,
): Promise<void> {
  if (!isNativePlatform) {
    throw new Error('栽培の編集は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();

  await db
    .update(schema.plantings)
    .set({
      cropId: input.cropId ?? null,
      cropName: input.cropName,
      cropNameReading: input.cropNameReading ?? null,
      variety: emptyToNull(input.variety),
      placeId: input.placeId ?? null,
      plantedOn: input.plantedOn,
      plantedAs: input.plantedAs,
      coverPhotoPath: input.coverPhotoPath ?? null,
      note: emptyToNull(input.note),
      updatedAt: nowIso(),
    })
    .where(eq(schema.plantings.id, plantingId));

  await replaceTags(db, schema, plantingId, input.tags);
  await updatePlantingFtsIndex(
    plantingId,
    input.cropName,
    input.cropNameReading ?? null,
    emptyToNull(input.variety),
    input.tags,
  );
}

/** 栽培終了（R01 のアーカイブ）。記録は残り、「終了した栽培」から見られる */
export async function endPlanting(
  plantingId: string,
  reason: PlantingEndedReason,
  endedAt: string = nowIso(),
): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();

  await db
    .update(schema.plantings)
    .set({ endedAt, endedReason: reason, updatedAt: nowIso() })
    .where(eq(schema.plantings.id, plantingId));
}

/** 栽培終了の取り消し。誤タップからの復帰用 */
export async function resumePlanting(plantingId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();

  await db
    .update(schema.plantings)
    .set({ endedAt: null, endedReason: null, updatedAt: nowIso() })
    .where(eq(schema.plantings.id, plantingId));
}

/**
 * 栽培の物理削除。
 *
 * だいどこの deleteRecipe は status='archived' の論理削除だったが、栽培では
 * それは「栽培終了」（endPlanting）が担う。両方を論理削除にすると
 * 「終了した栽培」の一覧に削除済みが混ざるため、削除は本当に消す。
 *
 * PRAGMA foreign_keys = ON なので子から順に消す。将来テーブルが増えたときに
 * 消し漏れると FOREIGN KEY constraint failed で落ちる（= 気づける）。
 */
export async function deletePlanting(plantingId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();

  // 作業ログ・収穫にぶら下がる写真は owner_id が子レコードの id を指すため、
  // 親を消す前に id を集めておく
  const careLogIds = (
    await db
      .select({ id: schema.careLogs.id })
      .from(schema.careLogs)
      .where(eq(schema.careLogs.plantingId, plantingId))
  ).map((row) => row.id);
  const harvestIds = (
    await db
      .select({ id: schema.harvests.id })
      .from(schema.harvests)
      .where(eq(schema.harvests.plantingId, plantingId))
  ).map((row) => row.id);

  const photoOwners: [string, string][] = [
    ['planting', plantingId],
    ...careLogIds.map((id): [string, string] => ['care_log', id]),
    ...harvestIds.map((id): [string, string] => ['harvest', id]),
  ];
  for (const [ownerType, ownerId] of photoOwners) {
    await db
      .delete(schema.photos)
      .where(and(eq(schema.photos.ownerType, ownerType), eq(schema.photos.ownerId, ownerId)));
  }

  await db.delete(schema.reminders).where(eq(schema.reminders.plantingId, plantingId));
  await db.delete(schema.harvests).where(eq(schema.harvests.plantingId, plantingId));
  await db.delete(schema.careLogs).where(eq(schema.careLogs.plantingId, plantingId));
  await db.delete(schema.plantingTags).where(eq(schema.plantingTags.plantingId, plantingId));
  await db.delete(schema.plantings).where(eq(schema.plantings.id, plantingId));

  await removePlantingFtsEntry(plantingId);
}

/**
 * 栽培フォームのタグ候補。
 *
 * tags テーブルはレシピと共有だが、getTagsForFamily() を使うと
 * だいどこ由来の料理タグ（揚げ物・汁物…）が候補に並ぶ。
 * 栽培に実際に付いているタグだけを返す。
 */
export async function getPlantingTagNames(): Promise<string[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .selectDistinct({ name: schema.tags.name })
    .from(schema.plantingTags)
    .innerJoin(schema.tags, eq(schema.plantingTags.tagId, schema.tags.id))
    .orderBy(asc(schema.tags.name));

  return rows.map((row) => row.name).filter(Boolean);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** 空文字は NULL にする。フォームの未入力欄が '' として保存されるのを防ぐ */
function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function getTagNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  plantingId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.plantingTags)
    .leftJoin(schema.tags, eq(schema.plantingTags.tagId, schema.tags.id))
    .where(eq(schema.plantingTags.plantingId, plantingId));
  return rows.map((row: { name: string | null }) => row.name ?? '').filter(Boolean);
}

/**
 * タグを張り替える。差分ではなく全消し＋再作成にしている。
 * 栽培のタグは数個で、差分計算の複雑さに見合わないため。
 */
async function replaceTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  plantingId: string,
  tagNames: string[],
): Promise<void> {
  await db.delete(schema.plantingTags).where(eq(schema.plantingTags.plantingId, plantingId));

  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const existing = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.familyId, FAMILY_ID), eq(schema.tags.name, name)))
      .limit(1);

    let tagId: string;
    if (existing.length > 0) {
      tagId = existing[0].id;
    } else {
      tagId = generateId();
      await db.insert(schema.tags).values({ id: tagId, familyId: FAMILY_ID, name, color: null });
    }

    await db.insert(schema.plantingTags).values({ plantingId, tagId });
  }
}

/**
 * 作業ログサービス — R04 / WBS 1.8
 *
 * 「やった！」の記録。栽培詳細のボタンから 1 タップで即保存し、
 * 写真とメモは後から足せる（R04 の受け入れ基準）。
 *
 * **収穫は含めない。** 数量・単位を持ち R07 アルバムと R18 統計の対象になるため
 * harvests テーブルへ分離してある（WBS 1.3 の決定 / docs/データ設計.md）。
 * 画面上は「やったことの記録」として並べるが、保存先が違う。収穫は WBS 2.1。
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import { resolvePhotoUris, toStoredPhotoPath } from './photo-path';
import { deleteGardenPhotoFiles, MAX_GARDEN_PHOTOS } from './photo-storage.service';
import type { CareLogItem, CareLogKind, SaveCareLogInput } from './types';

const PHOTO_OWNER = 'care_log';

export const CARE_KINDS = ['water', 'fertilize', 'transplant', 'prune', 'pest', 'other'] as const;

export const CARE_KIND_LABEL: Record<CareLogKind, string> = {
  water: '水やり',
  fertilize: '追肥',
  transplant: '植え替え',
  prune: '剪定',
  pest: '防除',
  other: 'その他',
};

/**
 * 詳細画面のクイック記録に出す種別。
 * R04 の「1〜2 タップ」を満たすには並べる数を絞る必要があり、
 * 植え替えは頻度が低いので編集画面からのみ選べるようにしている。
 */
export const QUICK_CARE_KINDS: CareLogKind[] = ['water', 'fertilize', 'prune', 'pest'];

function nowIso(): string {
  return new Date().toISOString();
}

/** 1 件の作業ログに紐づく写真のパスを順番に返す */
async function getPhotoPaths(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  logIds: string[],
): Promise<Map<string, string[]>> {
  const byLog = new Map<string, string[]>();
  if (logIds.length === 0) return byLog;

  const rows = await db
    .select({
      ownerId: schema.photos.ownerId,
      localPath: schema.photos.localPath,
      sortOrder: schema.photos.sortOrder,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), inArray(schema.photos.ownerId, logIds)));

  const sorted = [...rows].sort(
    (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder,
  );
  for (const row of sorted as { ownerId: string; localPath: string }[]) {
    const list = byLog.get(row.ownerId) ?? [];
    list.push(row.localPath);
    byLog.set(row.ownerId, list);
  }
  return byLog;
}

/** ある栽培の作業ログを新しい順に返す */
export async function getCareLogs(plantingId: string): Promise<CareLogItem[]> {
  if (!isNativePlatform) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: schema.careLogs.id,
      plantingId: schema.careLogs.plantingId,
      kind: schema.careLogs.kind,
      loggedAt: schema.careLogs.loggedAt,
      note: schema.careLogs.note,
    })
    .from(schema.careLogs)
    .where(eq(schema.careLogs.plantingId, plantingId))
    .orderBy(desc(schema.careLogs.loggedAt));

  const photos = await getPhotoPaths(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    plantingId: row.plantingId,
    kind: row.kind as CareLogKind,
    loggedAt: row.loggedAt,
    note: row.note,
    photoUris: resolvePhotoUris(photos.get(row.id) ?? []),
  }));
}

export async function getCareLog(logId: string): Promise<CareLogItem | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.careLogs.id,
      plantingId: schema.careLogs.plantingId,
      kind: schema.careLogs.kind,
      loggedAt: schema.careLogs.loggedAt,
      note: schema.careLogs.note,
    })
    .from(schema.careLogs)
    .where(eq(schema.careLogs.id, logId))
    .limit(1);
  if (rows.length === 0) return null;

  const photos = await getPhotoPaths(db, [logId]);
  const row = rows[0];
  return {
    id: row.id,
    plantingId: row.plantingId,
    kind: row.kind as CareLogKind,
    loggedAt: row.loggedAt,
    note: row.note,
    photoUris: resolvePhotoUris(photos.get(row.id) ?? []),
  };
}

/**
 * 作業ログを追加する。日時は既定で「今」（R04）。
 * 写真は保存済みのパスを受け取る（ファイルのコピーは photo-storage の担当）。
 */
export async function createCareLog(input: SaveCareLogInput): Promise<string> {
  if (!isNativePlatform) {
    throw new Error('作業ログの記録は端末（iOS/Android）でのみ利用できます');
  }

  const db = getDb();
  const id = generateId();
  const now = nowIso();

  await db.insert(schema.careLogs).values({
    id,
    plantingId: input.plantingId,
    kind: input.kind,
    loggedAt: input.loggedAt ?? now,
    note: input.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });

  await replacePhotos(db, id, input.photoUris ?? []);
  return id;
}

export async function updateCareLog(
  logId: string,
  input: Omit<SaveCareLogInput, 'plantingId'>,
): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  await db
    .update(schema.careLogs)
    .set({
      kind: input.kind,
      loggedAt: input.loggedAt ?? nowIso(),
      note: input.note?.trim() || null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.careLogs.id, logId));

  await replacePhotos(db, logId, input.photoUris ?? []);
}

export async function deleteCareLog(logId: string): Promise<void> {
  if (!isNativePlatform) return;

  const db = getDb();
  // 端末のファイルも消す。DB だけ消すと写真が残り続けて容量を食う
  const photos = await getPhotoPaths(db, [logId]);
  await deleteGardenPhotoFiles(photos.get(logId) ?? []);

  await db
    .delete(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), eq(schema.photos.ownerId, logId)));
  await db.delete(schema.careLogs).where(eq(schema.careLogs.id, logId));
}

/**
 * 写真の張り替え。
 *
 * 一覧から外された写真は端末のファイルごと消す。残す写真はパスが同じなので
 * ファイルには触らない（コピーし直すと写真が増殖する）。
 */
async function replacePhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  logId: string,
  photoUris: string[],
): Promise<void> {
  if (photoUris.length > MAX_GARDEN_PHOTOS) {
    throw new RangeError(`写真は${MAX_GARDEN_PHOTOS}枚まで追加できます`);
  }

  // **比較は DB と同じ正規形（相対パス）で行う。** 画面から来るのは絶対 URI なので、
  // 正規化せずに比べると「全部消された」と誤判定して残す写真まで削除してしまう
  const stored = photoUris.map(toStoredPhotoPath);
  const before = ((await getPhotoPaths(db, [logId])).get(logId) ?? []).map(toStoredPhotoPath);
  const removed = before.filter((path) => !stored.includes(path));
  await deleteGardenPhotoFiles(removed);

  await db
    .delete(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), eq(schema.photos.ownerId, logId)));

  const now = nowIso();
  for (let i = 0; i < stored.length; i++) {
    await db.insert(schema.photos).values({
      id: generateId(),
      ownerType: PHOTO_OWNER,
      ownerId: logId,
      localPath: stored[i],
      width: null,
      height: null,
      sortOrder: i + 1,
      createdAt: now,
    });
  }
}

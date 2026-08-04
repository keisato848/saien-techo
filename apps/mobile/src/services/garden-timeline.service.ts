/**
 * タイムライン — R05 / WBS 1.9
 *
 * 作業ログを栽培をまたいで時系列に並べる。だいどこの timeline.service は
 * 調理記録専用なので新設した（あちらは WBS 1.2 の削除対象に残っている）。
 *
 * 収穫（harvests）は WBS 2.1 でこの並びに合流させる。そのときテーブルを
 * またぐ UNION が要るので、返す型は最初から「作業ログ」と「収穫」を
 * 区別できる形にしてある。
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import type { CareLogKind, GardenTimelineEntry } from './types';

const PHOTO_OWNER = 'care_log';

export interface TimelineOptions {
  /** 未指定なら全栽培 */
  plantingId?: string;
  /** ISO 8601。この日時以降 */
  from?: string;
  /** ISO 8601。この日時以前 */
  to?: string;
  limit?: number;
}

/**
 * 作業ログを新しい順に返す。
 *
 * 栽培名を毎行に持たせるのは、ホームのタイムラインでは「どの株の作業か」が
 * 分からないと意味を成さないため。詳細画面から使うときは冗長になるが、
 * 呼び出し側で出し分ければよい。
 */
export async function getTimeline(options: TimelineOptions = {}): Promise<GardenTimelineEntry[]> {
  if (!isNativePlatform) return [];

  const db = getDb();

  const conditions = [];
  if (options.plantingId) conditions.push(eq(schema.careLogs.plantingId, options.plantingId));
  if (options.from) conditions.push(gte(schema.careLogs.loggedAt, options.from));
  if (options.to) conditions.push(lte(schema.careLogs.loggedAt, options.to));

  let query = db
    .select({
      id: schema.careLogs.id,
      plantingId: schema.careLogs.plantingId,
      cropName: schema.plantings.cropName,
      variety: schema.plantings.variety,
      kind: schema.careLogs.kind,
      loggedAt: schema.careLogs.loggedAt,
      note: schema.careLogs.note,
    })
    .from(schema.careLogs)
    .innerJoin(schema.plantings, eq(schema.careLogs.plantingId, schema.plantings.id))
    .$dynamic();

  if (conditions.length === 1) query = query.where(conditions[0]);
  else if (conditions.length > 1) query = query.where(and(...conditions));

  const rows = await query.orderBy(desc(schema.careLogs.loggedAt));
  const limited = options.limit ? rows.slice(0, options.limit) : rows;
  if (limited.length === 0) return [];

  // 写真は 1 クエリでまとめて引く。行ごとに引くと件数ぶん往復して重くなる
  const photoRows = await db
    .select({
      ownerId: schema.photos.ownerId,
      localPath: schema.photos.localPath,
      sortOrder: schema.photos.sortOrder,
    })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.ownerType, PHOTO_OWNER),
        inArray(
          schema.photos.ownerId,
          limited.map((row) => row.id),
        ),
      ),
    );

  const byOwner = new Map<string, string[]>();
  for (const row of [...photoRows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = byOwner.get(row.ownerId) ?? [];
    list.push(row.localPath);
    byOwner.set(row.ownerId, list);
  }

  return limited.map((row) => ({
    id: row.id,
    type: 'care_log' as const,
    plantingId: row.plantingId,
    cropName: row.cropName,
    variety: row.variety,
    kind: row.kind as CareLogKind,
    loggedAt: row.loggedAt,
    note: row.note,
    photoUris: byOwner.get(row.id) ?? [],
  }));
}

/**
 * 日付ごとに束ねる。タイムラインは「いつ何をしたか」を見るものなので、
 * 日付見出しが無いと同じ日の作業が並んでいることが読み取れない。
 */
export interface TimelineDay {
  /** YYYY-MM-DD（端末のタイムゾーン） */
  date: string;
  entries: GardenTimelineEntry[];
}

export function groupByDay(entries: GardenTimelineEntry[]): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const local = new Date(entry.loggedAt);
    // toISOString は UTC になるので、端末の日付でまとめる
    const date = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`;
    const last = days[days.length - 1];
    if (last && last.date === date) last.entries.push(entry);
    else days.push({ date, entries: [entry] });
  }
  return days;
}

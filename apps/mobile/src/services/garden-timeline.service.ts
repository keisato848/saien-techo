/**
 * タイムライン — R05 / WBS 1.9
 *
 * 作業ログを栽培をまたいで時系列に並べる。だいどこの timeline.service は
 * 調理記録専用なので新設した（あちらは WBS 1.2 の削除対象に残っている）。
 *
 * 作業ログと収穫は別テーブルなので、それぞれ引いてから時系列にマージする。
 * SQL の UNION にしないのは、写真がポリモーフィックな photos テーブルにあり、
 * どちらの owner_type かで引き分ける必要があって結局 2 回引くことになるため。
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import type { CareLogKind, GardenTimelineEntry, HarvestUnit } from './types';

const CARE_PHOTO_OWNER = 'care_log';
const HARVEST_PHOTO_OWNER = 'harvest';

const HARVEST_UNITS: readonly string[] = ['piece', 'g', 'kg', 'bunch', 'plant'];

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

  const careConditions = [];
  if (options.plantingId) careConditions.push(eq(schema.careLogs.plantingId, options.plantingId));
  if (options.from) careConditions.push(gte(schema.careLogs.loggedAt, options.from));
  if (options.to) careConditions.push(lte(schema.careLogs.loggedAt, options.to));

  let careQuery = db
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
  if (careConditions.length === 1) careQuery = careQuery.where(careConditions[0]);
  else if (careConditions.length > 1) careQuery = careQuery.where(and(...careConditions));

  const harvestConditions = [];
  if (options.plantingId) {
    harvestConditions.push(eq(schema.harvests.plantingId, options.plantingId));
  }
  if (options.from) harvestConditions.push(gte(schema.harvests.harvestedAt, options.from));
  if (options.to) harvestConditions.push(lte(schema.harvests.harvestedAt, options.to));

  let harvestQuery = db
    .select({
      id: schema.harvests.id,
      plantingId: schema.harvests.plantingId,
      cropName: schema.plantings.cropName,
      variety: schema.plantings.variety,
      quantity: schema.harvests.quantity,
      unit: schema.harvests.unit,
      loggedAt: schema.harvests.harvestedAt,
      note: schema.harvests.note,
    })
    .from(schema.harvests)
    .innerJoin(schema.plantings, eq(schema.harvests.plantingId, schema.plantings.id))
    .$dynamic();
  if (harvestConditions.length === 1) harvestQuery = harvestQuery.where(harvestConditions[0]);
  else if (harvestConditions.length > 1) {
    harvestQuery = harvestQuery.where(and(...harvestConditions));
  }

  const [careRows, harvestRows] = await Promise.all([
    careQuery.orderBy(desc(schema.careLogs.loggedAt)),
    harvestQuery.orderBy(desc(schema.harvests.harvestedAt)),
  ]);

  const merged: GardenTimelineEntry[] = [
    ...careRows.map((row) => ({
      id: row.id,
      type: 'care_log' as const,
      plantingId: row.plantingId,
      cropName: row.cropName,
      variety: row.variety,
      kind: row.kind as CareLogKind,
      quantity: null,
      unit: null,
      loggedAt: row.loggedAt,
      note: row.note,
      photoUris: [] as string[],
    })),
    ...harvestRows.map((row) => ({
      id: row.id,
      type: 'harvest' as const,
      plantingId: row.plantingId,
      cropName: row.cropName,
      variety: row.variety,
      kind: null,
      quantity: row.quantity,
      unit: HARVEST_UNITS.includes(row.unit ?? '') ? (row.unit as HarvestUnit) : null,
      loggedAt: row.loggedAt,
      note: row.note,
      photoUris: [] as string[],
    })),
  ];

  // 同じ時刻なら収穫を先に出す。まとめて記録したときは収穫の方が見たい情報
  merged.sort(
    (a, b) =>
      b.loggedAt.localeCompare(a.loggedAt) ||
      (a.type === b.type ? 0 : a.type === 'harvest' ? -1 : 1),
  );

  const limited = options.limit ? merged.slice(0, options.limit) : merged;
  if (limited.length === 0) return [];

  // 写真は owner_type ごとに 1 クエリでまとめて引く。
  // 行ごとに引くと件数ぶん往復して重くなる
  const byOwner = new Map<string, string[]>();
  for (const ownerType of [CARE_PHOTO_OWNER, HARVEST_PHOTO_OWNER]) {
    const wantCareLog = ownerType === CARE_PHOTO_OWNER;
    const ids = limited
      .filter((entry) => (entry.type === 'care_log') === wantCareLog)
      .map((entry) => entry.id);
    if (ids.length === 0) continue;

    const photoRows = await db
      .select({
        ownerId: schema.photos.ownerId,
        localPath: schema.photos.localPath,
        sortOrder: schema.photos.sortOrder,
      })
      .from(schema.photos)
      .where(and(eq(schema.photos.ownerType, ownerType), inArray(schema.photos.ownerId, ids)));

    for (const row of [...photoRows].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = byOwner.get(row.ownerId) ?? [];
      list.push(row.localPath);
      byOwner.set(row.ownerId, list);
    }
  }

  return limited.map((entry) => ({ ...entry, photoUris: byOwner.get(entry.id) ?? [] }));
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

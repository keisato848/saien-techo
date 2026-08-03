/**
 * 場所（区画）サービス — R02
 *
 * WBS 1.5 では栽培登録の場所ピッカーに必要な読み取りだけを実装する。
 * 登録・並べ替え・アーカイブは WBS 1.6（場所管理）で追加する。
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import type { PlaceItem } from './types';

const FAMILY_ID = 'family-001';

export const PLACE_KIND_LABEL: Record<string, string> = {
  planter: 'プランター',
  row: '畝',
  plot: '区画',
  other: 'その他',
};

/** 未アーカイブの場所を並び順で返す */
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

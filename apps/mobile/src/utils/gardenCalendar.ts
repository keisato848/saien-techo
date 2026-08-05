/**
 * カレンダーとギャラリーの純ロジック（R05 / WBS 2.3）
 *
 * 升目づくりは utils/monthMatrix.ts。ここは菜園の記録に固有の部分だけ。
 */
import type { GardenTimelineEntry } from '../services/types';
import { localDayKey } from './monthMatrix';

/**
 * 1 日ぶんの要約。カレンダーのマスに出す。
 *
 * 点は「作業があったか」「収穫があったか」の 2 つだけにする。
 * 作業種別ごとに 6 色を割り当てる案もあったが、1 マスが 40px 前後しかなく、
 * 色を増やすと何色なのか判別できない。栽培の件数を点の数で表す案も試したが、
 * 凡例の「緑=作業 / 橙=収穫」と衝突して読めなくなった（実機で確認）。
 */
export interface CalendarDaySummary {
  entries: GardenTimelineEntry[];
  hasCareLog: boolean;
  hasHarvest: boolean;
}

/**
 * 日ごとにまとめる。端末のタイムゾーンで束ねる
 * （toISOString() だと深夜の記録が前日のマスに入る）。
 */
export function groupGardenEntriesByDay(
  entries: GardenTimelineEntry[],
): Map<string, CalendarDaySummary> {
  const map = new Map<string, CalendarDaySummary>();

  for (const entry of entries) {
    const key = localDayKey(new Date(entry.loggedAt));
    const current = map.get(key);
    if (current) {
      current.entries.push(entry);
      current.hasHarvest = current.hasHarvest || entry.type === 'harvest';
      current.hasCareLog = current.hasCareLog || entry.type === 'care_log';
    } else {
      map.set(key, {
        entries: [entry],
        hasCareLog: entry.type === 'care_log',
        hasHarvest: entry.type === 'harvest',
      });
    }
  }

  return map;
}

/** ギャラリーの 1 枚 */
export interface GardenPhoto {
  /** 同じ記録の 2 枚目以降も区別できる一意キー */
  key: string;
  uri: string;
  entryId: string;
  type: GardenTimelineEntry['type'];
  plantingId: string;
  cropName: string;
  loggedAt: string;
}

/**
 * 記録に紐づく写真を 1 本の配列に潰す。新しい順。
 *
 * 作業ログと収穫を混ぜるのは、R05 のギャラリーが「菜園の写真ぜんぶ」だから。
 * 収穫だけを見たいときは収穫タブのアルバム（R07 / WBS 2.2）がある。
 */
export function flattenGardenPhotos(entries: GardenTimelineEntry[]): GardenPhoto[] {
  const photos: GardenPhoto[] = [];

  for (const entry of entries) {
    entry.photoUris.forEach((uri, index) => {
      photos.push({
        key: `${entry.id}-${index}`,
        uri,
        entryId: entry.id,
        type: entry.type,
        plantingId: entry.plantingId,
        cropName: entry.cropName,
        loggedAt: entry.loggedAt,
      });
    });
  }

  return photos.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

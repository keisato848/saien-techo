/**
 * Pure helpers for the cooking-log calendar view (R12 / 利用フロー §5)
 *
 * 升目づくりは utils/monthMatrix.ts へ移した（菜園側と共通のため）。
 * ここに残るのは調理記録に固有のグルーピングだけ。
 */
import type { TimelineEntry } from '../services/types';

export { buildMonthMatrix, localDayKey, WEEKDAY_LABELS, type CalendarCell } from './monthMatrix';

import { localDayKey as toDayKey } from './monthMatrix';

/** Group timeline entries by their local cooked-day key. */
export function groupEntriesByDay(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const map = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const key = toDayKey(new Date(entry.cookedAt));
    const list = map.get(key);
    if (list) {
      list.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }
  return map;
}

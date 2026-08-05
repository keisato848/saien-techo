/**
 * 月グリッドの組み立て（アプリ非依存の純ロジック）
 *
 * だいどこの calendar.ts から切り出した。カレンダーの升目づくりは
 * 調理記録にも菜園にも共通で、recipes 系を削除するときに巻き込まれると困るため。
 */

export interface CalendarCell {
  /** 日（1〜31） */
  day: number;
  /** 端末ローカルの 'YYYY-MM-DD' */
  key: string;
  /** 表示中の月に属するか（前後の月の埋め草は false） */
  inMonth: boolean;
}

/**
 * 端末のタイムゾーンでの 'YYYY-MM-DD'。
 * toISOString() を使うと深夜の記録が前日に寄る。
 */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 日曜始まりの週×7 マスの行列を作る。
 * 前後の月のマスも埋めるので、どの週も必ず 7 マスになる。
 */
export function buildMonthMatrix(year: number, month: number): CalendarCell[][] {
  const startOffset = new Date(year, month, 1).getDay(); // 0 = 日曜
  const lastDay = new Date(year, month + 1, 0).getDate();
  const numWeeks = Math.ceil((startOffset + lastDay) / 7);

  const cursor = new Date(year, month, 1 - startOffset);
  const weeks: CalendarCell[][] = [];

  for (let w = 0; w < numWeeks; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        day: cursor.getDate(),
        key: localDayKey(cursor),
        inMonth: cursor.getMonth() === month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

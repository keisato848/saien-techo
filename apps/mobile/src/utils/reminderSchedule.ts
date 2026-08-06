/**
 * リマインダーの次回時刻の計算（R11 / WBS 2.4）
 *
 * 純ロジックにしているのは、ここが**唯一ずれると気づけない**箇所だから。
 * 通知が来ない／来すぎるのは端末で数日回さないと分からないので、
 * 境界（今日のこの時刻ちょうど・月またぎ・週またぎ）はテストで固定する。
 */
import type { ReminderItem } from '../services/types';

export const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 端末ローカルで、その日の h:m を指す Date */
function atTime(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 次に鳴る時刻。無効なら null。
 *
 * `from` より**後**を返す（同時刻は「もう鳴った」とみなす）。
 * 同時刻を含めると、鳴った直後の再計算で同じ時刻を返して二重に鳴る。
 */
export function nextOccurrence(reminder: ReminderItem, from: Date = new Date()): Date | null {
  if (!reminder.enabled) return null;

  const { hour, minute } = reminder;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  switch (reminder.scheduleKind) {
    case 'daily': {
      const today = atTime(from, hour, minute);
      return today > from ? today : addDays(today, 1);
    }

    case 'weekly': {
      const weekdays = [...new Set(reminder.weekdays)].filter(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6,
      );
      if (weekdays.length === 0) return null;

      // 今日から 7 日先まで見て、最初に当たる日
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = atTime(addDays(from, offset), hour, minute);
        if (candidate <= from) continue;
        if (weekdays.includes(candidate.getDay())) return candidate;
      }
      return null;
    }

    case 'interval_days': {
      const interval = reminder.intervalDays ?? 0;
      if (!Number.isInteger(interval) || interval < 1) return null;

      // 起点は最後に鳴った日。まだ鳴っていなければ作成日
      const base = new Date(reminder.lastFiredAt ?? reminder.createdAt);
      if (Number.isNaN(base.getTime())) return null;

      let candidate = atTime(base, hour, minute);
      // 起点当日は鳴らさない（作成直後に鳴ると「設定しただけで通知が来た」になる）
      if (candidate <= from) {
        const daysSince = Math.floor((from.getTime() - candidate.getTime()) / 86_400_000);
        // 一気に進めてから、超えるまで 1 周期ずつ足す（長く開いても回数が増えない）
        candidate = addDays(
          candidate,
          Math.max(interval, Math.ceil(daysSince / interval) * interval),
        );
        while (candidate <= from) candidate = addDays(candidate, interval);
      }
      return candidate;
    }

    default:
      return null;
  }
}

/** 設定内容を 1 行で。UI と通知本文の両方で使う */
export function describeSchedule(reminder: ReminderItem): string {
  const time = `${reminder.hour}:${String(reminder.minute).padStart(2, '0')}`;

  switch (reminder.scheduleKind) {
    case 'daily':
      return `毎日 ${time}`;

    case 'interval_days': {
      const interval = reminder.intervalDays ?? 0;
      return interval > 0 ? `${interval}日おき ${time}` : `— ${time}`;
    }

    case 'weekly': {
      const days = [...new Set(reminder.weekdays)]
        .filter((day) => day >= 0 && day <= 6)
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_SHORT[day]);
      return days.length > 0 ? `毎週 ${days.join('・')} ${time}` : `— ${time}`;
    }

    default:
      return time;
  }
}

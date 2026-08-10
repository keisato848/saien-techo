import type { ReminderItem } from '../../services/types';
import {
  describeSchedule,
  isSameLocalDay,
  nextOccurrence,
  occurrenceOn,
} from '../reminderSchedule';

function reminder(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return {
    id: 'r1',
    plantingId: 'p1',
    kind: 'water',
    scheduleKind: 'daily',
    intervalDays: null,
    weekdays: [],
    hour: 7,
    minute: 0,
    enabled: true,
    lastFiredAt: null,
    createdAt: new Date(2026, 7, 1, 12).toISOString(),
    ...overrides,
  };
}

/** 端末ローカルの日時を素直に作る（月は 0 始まり） */
function at(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('nextOccurrence', () => {
  it('無効なら null', () => {
    expect(nextOccurrence(reminder({ enabled: false }), at(2026, 8, 10, 6))).toBeNull();
  });

  describe('毎日', () => {
    it('時刻前なら今日', () => {
      const next = nextOccurrence(reminder(), at(2026, 8, 10, 6, 30));
      expect(next).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('時刻を過ぎていたら翌日', () => {
      const next = nextOccurrence(reminder(), at(2026, 8, 10, 7, 30));
      expect(next).toEqual(at(2026, 8, 11, 7, 0));
    });

    it('ちょうど同時刻なら翌日（二重に鳴らさない）', () => {
      const next = nextOccurrence(reminder(), at(2026, 8, 10, 7, 0));
      expect(next).toEqual(at(2026, 8, 11, 7, 0));
    });

    it('月をまたぐ', () => {
      const next = nextOccurrence(reminder(), at(2026, 8, 31, 8));
      expect(next).toEqual(at(2026, 9, 1, 7, 0));
    });

    it('年をまたぐ', () => {
      const next = nextOccurrence(reminder(), at(2026, 12, 31, 8));
      expect(next).toEqual(at(2027, 1, 1, 7, 0));
    });
  });

  describe('曜日指定', () => {
    // 2026-08-10 は月曜
    it('同じ曜日で時刻前なら今日', () => {
      const next = nextOccurrence(
        reminder({ scheduleKind: 'weekly', weekdays: [1] }),
        at(2026, 8, 10, 6),
      );
      expect(next).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('同じ曜日でも時刻を過ぎていたら翌週', () => {
      const next = nextOccurrence(
        reminder({ scheduleKind: 'weekly', weekdays: [1] }),
        at(2026, 8, 10, 8),
      );
      expect(next).toEqual(at(2026, 8, 17, 7, 0));
    });

    it('複数の曜日なら直近を返す', () => {
      // 月(1)と木(4)。月曜の 8 時から見ると次は木曜
      const next = nextOccurrence(
        reminder({ scheduleKind: 'weekly', weekdays: [1, 4] }),
        at(2026, 8, 10, 8),
      );
      expect(next).toEqual(at(2026, 8, 13, 7, 0));
    });

    it('曜日の重複は畳む', () => {
      const next = nextOccurrence(
        reminder({ scheduleKind: 'weekly', weekdays: [1, 1, 1] }),
        at(2026, 8, 10, 6),
      );
      expect(next).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('曜日が空なら null', () => {
      expect(
        nextOccurrence(reminder({ scheduleKind: 'weekly', weekdays: [] }), at(2026, 8, 10, 6)),
      ).toBeNull();
    });

    it('範囲外の曜日は無視する', () => {
      expect(
        nextOccurrence(reminder({ scheduleKind: 'weekly', weekdays: [9] }), at(2026, 8, 10, 6)),
      ).toBeNull();
    });
  });

  describe('N日おき', () => {
    it('作成当日には鳴らさない（設定しただけで通知が来ない）', () => {
      const next = nextOccurrence(
        reminder({
          scheduleKind: 'interval_days',
          intervalDays: 3,
          createdAt: at(2026, 8, 10, 12).toISOString(),
        }),
        at(2026, 8, 10, 18),
      );
      expect(next).toEqual(at(2026, 8, 13, 7, 0));
    });

    it('最後に鳴った日から N 日後', () => {
      const next = nextOccurrence(
        reminder({
          scheduleKind: 'interval_days',
          intervalDays: 3,
          lastFiredAt: at(2026, 8, 10, 7).toISOString(),
        }),
        at(2026, 8, 10, 8),
      );
      expect(next).toEqual(at(2026, 8, 13, 7, 0));
    });

    it('長く開いても 1 回ぶんだけ先を返す（溜まった通知が連打されない）', () => {
      const next = nextOccurrence(
        reminder({
          scheduleKind: 'interval_days',
          intervalDays: 3,
          lastFiredAt: at(2026, 7, 1, 7).toISOString(),
        }),
        at(2026, 8, 10, 8),
      );

      expect(next).not.toBeNull();
      expect((next as Date).getTime()).toBeGreaterThan(at(2026, 8, 10, 8).getTime());
      // 次の 1 回は 3 日以内に来る
      expect((next as Date).getTime()).toBeLessThanOrEqual(at(2026, 8, 13, 8).getTime());
    });

    it('周期が 1 日なら毎日と同じ間隔になる', () => {
      const next = nextOccurrence(
        reminder({
          scheduleKind: 'interval_days',
          intervalDays: 1,
          lastFiredAt: at(2026, 8, 10, 7).toISOString(),
        }),
        at(2026, 8, 10, 8),
      );
      expect(next).toEqual(at(2026, 8, 11, 7, 0));
    });

    it('周期が未設定・0・負なら null', () => {
      for (const intervalDays of [null, 0, -1]) {
        expect(
          nextOccurrence(
            reminder({ scheduleKind: 'interval_days', intervalDays }),
            at(2026, 8, 10, 6),
          ),
        ).toBeNull();
      }
    });

    it('起点が壊れていたら null', () => {
      expect(
        nextOccurrence(
          reminder({ scheduleKind: 'interval_days', intervalDays: 3, lastFiredAt: 'こわれた' }),
          at(2026, 8, 10, 6),
        ),
      ).toBeNull();
    });
  });

  describe('時刻の検証', () => {
    it('範囲外の時刻は null', () => {
      expect(nextOccurrence(reminder({ hour: 24 }), at(2026, 8, 10, 6))).toBeNull();
      expect(nextOccurrence(reminder({ minute: 60 }), at(2026, 8, 10, 6))).toBeNull();
      expect(nextOccurrence(reminder({ hour: -1 }), at(2026, 8, 10, 6))).toBeNull();
    });

    it('0:00 も有効', () => {
      const next = nextOccurrence(reminder({ hour: 0, minute: 0 }), at(2026, 8, 10, 6));
      expect(next).toEqual(at(2026, 8, 11, 0, 0));
    });
  });
});

describe('describeSchedule', () => {
  it('毎日', () => {
    expect(describeSchedule(reminder({ hour: 7, minute: 0 }))).toBe('毎日 7:00');
  });

  it('分を 2 桁で出す', () => {
    expect(describeSchedule(reminder({ hour: 18, minute: 5 }))).toBe('毎日 18:05');
  });

  it('N日おき', () => {
    expect(describeSchedule(reminder({ scheduleKind: 'interval_days', intervalDays: 3 }))).toBe(
      '3日おき 7:00',
    );
  });

  it('曜日は日曜始まりで並べる', () => {
    expect(describeSchedule(reminder({ scheduleKind: 'weekly', weekdays: [4, 1, 0] }))).toBe(
      '毎週 日・月・木 7:00',
    );
  });

  it('設定が欠けていても落ちない', () => {
    expect(describeSchedule(reminder({ scheduleKind: 'weekly', weekdays: [] }))).toBe('— 7:00');
    expect(describeSchedule(reminder({ scheduleKind: 'interval_days', intervalDays: null }))).toBe(
      '— 7:00',
    );
  });
});

describe('isSameLocalDay', () => {
  it('同じ日なら true（時刻は問わない）', () => {
    expect(isSameLocalDay(at(2026, 8, 10, 0, 0), at(2026, 8, 10, 23, 59))).toBe(true);
  });

  it('日をまたぐと false', () => {
    expect(isSameLocalDay(at(2026, 8, 10, 23, 59), at(2026, 8, 11, 0, 0))).toBe(false);
  });
});

describe('occurrenceOn', () => {
  it('無効なら null', () => {
    expect(occurrenceOn(reminder({ enabled: false }), at(2026, 8, 10, 12))).toBeNull();
  });

  describe('毎日', () => {
    // ホームは日中いつ開かれるか分からない。朝でも夜でも同じ答えになること
    it('時刻前に見ても今日の予定を返す', () => {
      expect(occurrenceOn(reminder(), at(2026, 8, 10, 6, 30))).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('時刻を過ぎて見ても今日の予定を返す（消さない）', () => {
      expect(occurrenceOn(reminder(), at(2026, 8, 10, 18, 0))).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('0:00 ちょうどの予定も拾う', () => {
      const midnight = reminder({ hour: 0, minute: 0 });
      expect(occurrenceOn(midnight, at(2026, 8, 10, 9, 0))).toEqual(at(2026, 8, 10, 0, 0));
    });
  });

  describe('曜日', () => {
    const monday = reminder({ scheduleKind: 'weekly', weekdays: [1] });

    it('その曜日なら返す', () => {
      // 2026-08-10 は月曜
      expect(at(2026, 8, 10).getDay()).toBe(1);
      expect(occurrenceOn(monday, at(2026, 8, 10, 20, 0))).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('違う曜日なら null（明日の予定を今日に出さない）', () => {
      expect(occurrenceOn(monday, at(2026, 8, 11, 6, 0))).toBeNull();
    });
  });

  describe('N日おき', () => {
    const every3 = reminder({
      scheduleKind: 'interval_days',
      intervalDays: 3,
      lastFiredAt: at(2026, 8, 7, 7, 0).toISOString(),
    });

    it('周期に当たる日なら返す', () => {
      expect(occurrenceOn(every3, at(2026, 8, 10, 12, 0))).toEqual(at(2026, 8, 10, 7, 0));
    });

    it('当たらない日は null', () => {
      expect(occurrenceOn(every3, at(2026, 8, 11, 12, 0))).toBeNull();
    });
  });
});

/**
 * 月グリッドの組み立て（WBS T1 のテスト整備）。
 *
 * カレンダー画面のマスは全部ここから出る。壊れても画面は「カレンダーらしいもの」を
 * 出し続けてしまう（曜日が 1 つずれた月表、末尾の週が欠けた月表）ので、
 * 端の月だけは形を固定しておく。
 *
 * 選んだのは 2026 年の 3 か月。1 日が日曜で 4 週ちょうどの 2 月、
 * 1 日が土曜で 6 週に伸びる 8 月、どちらでもない 9 月。
 */
import { buildMonthMatrix, localDayKey, WEEKDAY_LABELS } from '../monthMatrix';

describe('buildMonthMatrix', () => {
  it('どの週も 7 マスになる（前後の月で埋める）', () => {
    for (const month of [1, 7, 8]) {
      const weeks = buildMonthMatrix(2026, month);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  it('1 日が日曜で月末が土曜の月は、埋め草なしの 4 週になる', () => {
    // 2026 年 2 月は 1 日が日曜で 28 日
    const weeks = buildMonthMatrix(2026, 1);

    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every((cell) => cell.inMonth)).toBe(true);
    expect(weeks[0][0]).toMatchObject({ day: 1, key: '2026-02-01' });
    expect(weeks[3][6]).toMatchObject({ day: 28, key: '2026-02-28' });
  });

  // 5 週で足りると決め打つと、月末が最終週からこぼれる
  it('1 日が土曜の 31 日ある月は 6 週に伸びる', () => {
    // 2026 年 8 月は 1 日が土曜で 31 日
    const weeks = buildMonthMatrix(2026, 7);

    expect(weeks).toHaveLength(6);
    expect(weeks[0][6]).toMatchObject({ day: 1, inMonth: true });
    expect(weeks.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it('前後の月のマスは inMonth を落とす（記録を引きに行かないため）', () => {
    // 2026 年 9 月は 1 日が火曜。先頭は 8/30・8/31、末尾は 10/1〜10/3
    const weeks = buildMonthMatrix(2026, 8);
    const flat = weeks.flat();

    expect(flat.slice(0, 2)).toEqual([
      { day: 30, key: '2026-08-30', inMonth: false },
      { day: 31, key: '2026-08-31', inMonth: false },
    ]);
    expect(flat[2]).toEqual({ day: 1, key: '2026-09-01', inMonth: true });
    expect(flat[flat.length - 1]).toEqual({ day: 3, key: '2026-10-03', inMonth: false });
  });
});

describe('localDayKey', () => {
  // toISOString() だと深夜の記録が前日のマスに落ちる
  it('端末のタイムゾーンの日付を、ゼロ埋めして返す', () => {
    expect(localDayKey(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
    expect(localDayKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('WEEKDAY_LABELS', () => {
  // 見出しは日曜始まり。グリッドが月曜始まりになると、曜日の列が 1 つずれる
  it('見出しの並びが、グリッドの先頭列（日曜）と揃っている', () => {
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(WEEKDAY_LABELS[0]).toBe('日');

    // 2026-02-01 は日曜。その日が先頭列に来る
    expect(buildMonthMatrix(2026, 1)[0][0].key).toBe('2026-02-01');
  });
});

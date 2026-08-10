import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  CARE_LOG_DATE_QUICK_PICKS,
  DateField,
  formatDateLabel,
  isoDaysAgo,
  PLANTING_DATE_QUICK_PICKS,
} from '../DateField';

// ネイティブのピッカーは jest では描けないので、開いたことだけ分かるようにする
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

describe('formatDateLabel', () => {
  it('和暦ではなく西暦の年月日で出す', () => {
    expect(formatDateLabel('2026-08-04T03:00:00.000Z')).toMatch(/^2026年8月\d+日$/);
  });

  it('日付として解釈できない値は「—」', () => {
    expect(formatDateLabel('きのう')).toBe('—');
  });
});

describe('DateField', () => {
  const iso = new Date(2026, 7, 4, 12).toISOString();

  it('ラベルと日付を表示する', () => {
    render(<DateField label="植え付け日" value={iso} onChange={jest.fn()} />);

    expect(screen.getByText('植え付け日')).toBeTruthy();
    expect(screen.getByText('2026年8月4日')).toBeTruthy();
  });

  it('required のとき「 *」を出す', () => {
    render(<DateField label="収穫日" required value={iso} onChange={jest.fn()} />);
    expect(screen.getByText(' *')).toBeTruthy();
  });

  it('「今日」を押すと今日の日付を返す', () => {
    const onChange = jest.fn();
    render(<DateField label="収穫日" value={iso} onChange={onChange} />);

    fireEvent.press(screen.getByText('今日'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = new Date(onChange.mock.calls[0][0] as string);
    expect(passed.toDateString()).toBe(new Date().toDateString());
  });

  it('エラーを表示する', () => {
    render(
      <DateField
        label="植え付け日"
        value={iso}
        onChange={jest.fn()}
        error="未来の日付は登録できません"
      />,
    );
    expect(screen.getByText('未来の日付は登録できません')).toBeTruthy();
  });

  it('不正な日付でも落ちない（「—」を出す）', () => {
    render(<DateField label="日付" value="こわれた値" onChange={jest.fn()} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('quickPicks を渡さなければチップは出ない', () => {
    render(<DateField label="日付" value={iso} onChange={jest.fn()} />);
    expect(screen.queryByText('1週間前')).toBeNull();
  });

  it('hint を渡すと補足を出す', () => {
    render(<DateField label="植え付け日" value={iso} onChange={jest.fn()} hint="今日で 7 日目" />);
    expect(screen.getByText('今日で 7 日目')).toBeTruthy();
  });

  it('クイック選択でちょうど n 日前を返す', () => {
    const onChange = jest.fn();
    render(
      <DateField
        label="植え付け日"
        value={iso}
        onChange={onChange}
        quickPicks={PLANTING_DATE_QUICK_PICKS}
      />,
    );

    fireEvent.press(screen.getByText('3か月前'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = new Date(onChange.mock.calls[0][0] as string);
    expect(Math.round((Date.now() - passed.getTime()) / 86_400_000)).toBe(90);
  });
});

describe('isoDaysAgo', () => {
  // elapsedDaysFrom は floor((end - start) / 86400000) で数える。
  // 日付を切り下げてしまうと「1週間前」を押した直後が 6 日目になり、
  // チップの文言と画面の日数が食い違う
  it('floor で数えても label どおりの日数になる', () => {
    const now = new Date('2026-08-10T09:30:00.000Z');
    for (const pick of [...PLANTING_DATE_QUICK_PICKS, ...CARE_LOG_DATE_QUICK_PICKS]) {
      const iso = isoDaysAgo(pick.daysAgo, now);
      const elapsed = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
      expect(elapsed).toBe(pick.daysAgo);
    }
  });

  it('さかのぼった日付は未来にならない（登録が弾かれない）', () => {
    const now = new Date();
    for (const pick of PLANTING_DATE_QUICK_PICKS) {
      expect(new Date(isoDaysAgo(pick.daysAgo, now)).getTime()).toBeLessThan(now.getTime());
    }
  });
});

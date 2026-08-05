import { fireEvent, render, screen } from '@testing-library/react-native';

import { DateField, formatDateLabel } from '../DateField';

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
});

/**
 * ケアスケジュール提案シートのテスト（R26 / WBS 4.8）。
 * 見るのは**既定が OFF であること**と、選んだものだけが onApply に渡ること。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CareScheduleSheet } from '../CareScheduleSheet';
import type { CareScheduleSuggestion } from '../../services/care-schedule.service';

const WATER: CareScheduleSuggestion = {
  kind: 'water',
  scheduleKind: 'interval_days',
  intervalDays: 3,
  hour: 7,
  minute: 0,
  reason: '乾かし気味に育てると甘くなる。',
};

const FERTILIZE: CareScheduleSuggestion = {
  kind: 'fertilize',
  scheduleKind: 'interval_days',
  intervalDays: 20,
  hour: 9,
  minute: 0,
  reason: '1回目は植え付けから20日ごろが目安。以後20日おきです。',
};

function setup(suggestions: CareScheduleSuggestion[] = [WATER, FERTILIZE]) {
  const onApply = jest.fn();
  const onSkip = jest.fn();
  render(
    <CareScheduleSheet
      visible
      cropName="トマト"
      suggestions={suggestions}
      onApply={onApply}
      onSkip={onSkip}
    />,
  );
  return { onApply, onSkip };
}

describe('CareScheduleSheet', () => {
  it('登録が済んだことを伝えたうえで提案を並べる', () => {
    setup();

    expect(screen.getByText(/トマトを登録しました/)).toBeTruthy();
    expect(screen.getByText('水やり／3日おき 7:00')).toBeTruthy();
    expect(screen.getByText('追肥／20日おき 9:00')).toBeTruthy();
  });

  it('既定はすべて OFF で、何も選ばずには作れない', () => {
    const { onApply } = setup();

    expect(screen.getByLabelText('水やり 3日おき 7:00').props.accessibilityState).toMatchObject({
      checked: false,
    });

    fireEvent.press(screen.getByLabelText('選んだお知らせを作る'));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('選んだものだけを渡す', () => {
    const { onApply } = setup();

    fireEvent.press(screen.getByLabelText('追肥 20日おき 9:00'));
    fireEvent.press(screen.getByLabelText('選んだお知らせを作る'));

    expect(onApply).toHaveBeenCalledWith([FERTILIZE]);
  });

  it('もう一度押すと選択が外れる', () => {
    const { onApply } = setup();

    fireEvent.press(screen.getByLabelText('水やり 3日おき 7:00'));
    fireEvent.press(screen.getByLabelText('水やり 3日おき 7:00'));
    fireEvent.press(screen.getByLabelText('選んだお知らせを作る'));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('「あとで」は何も作らずに閉じる', () => {
    const { onApply, onSkip } = setup();

    fireEvent.press(screen.getByLabelText('あとで'));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('時刻が目安であることを添える（Doze で数十分ずれるため）', () => {
    setup();

    expect(screen.getByText(/時刻はおおよその目安です/)).toBeTruthy();
  });
});

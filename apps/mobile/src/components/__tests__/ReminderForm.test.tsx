import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ReminderForm } from '../ReminderForm';

function setup(props: Partial<React.ComponentProps<typeof ReminderForm>> = {}) {
  const onSubmit = jest.fn(() => Promise.resolve());
  const onCancel = jest.fn();
  render(
    <ReminderForm onSubmit={onSubmit} onCancel={onCancel} title="お知らせを追加" {...props} />,
  );
  return { onSubmit, onCancel };
}

describe('ReminderForm', () => {
  it('既定は「毎日」「水やり」7:00', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: 'water',
      scheduleKind: 'daily',
      hour: 7,
      minute: 0,
    });
  });

  it('毎日のときは曜日も間隔も出さない', () => {
    setup();

    expect(screen.queryByText('曜日')).toBeNull();
    expect(screen.queryByText('間隔')).toBeNull();
  });

  it('「曜日で」を選ぶと曜日が出る', () => {
    setup();

    fireEvent.press(screen.getByText('曜日で'));

    expect(screen.getByText('曜日')).toBeTruthy();
    expect(screen.getByLabelText('月曜日')).toBeTruthy();
  });

  it('曜日を選ばないうちは保存できない', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('曜日で'));
    fireEvent.press(screen.getByText('保存'));

    expect(screen.getByText('曜日を 1 つ以上選んでください。')).toBeTruthy();
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('曜日を選べば保存でき、値が渡る', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('曜日で'));
    fireEvent.press(screen.getByLabelText('月曜日'));
    fireEvent.press(screen.getByLabelText('木曜日'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].weekdays.sort()).toEqual([1, 4]);
  });

  it('選んだ曜日をもう一度押すと外れる', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('曜日で'));
    fireEvent.press(screen.getByLabelText('月曜日'));
    fireEvent.press(screen.getByLabelText('木曜日'));
    fireEvent.press(screen.getByLabelText('月曜日'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].weekdays).toEqual([4]);
  });

  it('「日数で」を選ぶと間隔が出て、止まりうる旨を伝える', () => {
    setup();

    fireEvent.press(screen.getByText('日数で'));

    expect(screen.getByText('間隔')).toBeTruthy();
    expect(screen.getByText(/アプリをしばらく開かないと止まります/)).toBeTruthy();
  });

  it('間隔を数値にして渡す', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('日数で'));
    fireEvent.changeText(screen.getByLabelText('間隔の日数'), '5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].intervalDays).toBe(5);
  });

  it('間隔が 0 や空なら保存できない', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('日数で'));
    fireEvent.changeText(screen.getByLabelText('間隔の日数'), '0');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('時刻を選び直せる', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('18時'));
    fireEvent.press(screen.getByText('30分'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ hour: 18, minute: 30 });
  });

  it('作業の種類を選び直せる', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('追肥'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].kind).toBe('fertilize');
  });

  it('ずれうることを必ず伝える（「必ずこの時刻」と誤解させない）', () => {
    setup();
    expect(screen.getByText(/数十分ずれて届くことがあります/)).toBeTruthy();
  });

  it('編集時は値が埋まっている', () => {
    setup({
      initialValues: {
        kind: 'pest',
        scheduleKind: 'weekly',
        weekdays: [2],
        hour: 18,
        minute: 30,
      },
    });

    expect(screen.getByText('曜日')).toBeTruthy();
    expect(screen.queryByText('曜日を 1 つ以上選んでください。')).toBeNull();
  });

  it('キャンセルで onCancel を呼ぶ', () => {
    const { onCancel } = setup();
    fireEvent.press(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

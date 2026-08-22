import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MaterialForm } from '../MaterialForm';

function setup(props: Partial<React.ComponentProps<typeof MaterialForm>> = {}) {
  const onSubmit = jest.fn(() => Promise.resolve());
  const onCancel = jest.fn();
  render(<MaterialForm onSubmit={onSubmit} onCancel={onCancel} title="資材を追加" {...props} />);
  return { onSubmit, onCancel };
}

describe('MaterialForm', () => {
  it('名前が空のままでは保存しない', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    expect(screen.getByText('名前は必須です')).toBeTruthy();
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('空白だけの名前も弾く', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '   ');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('名前だけで保存でき、既定の分類は肥料', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '化成肥料');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: '化成肥料',
      category: 'fertilizer',
      quantity: null,
      lowThreshold: null,
    });
  });

  it('分類を選び直せる', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), 'トマトの種');
    fireEvent.press(screen.getByText('種・苗'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].category).toBe('seed');
  });

  it('数量を入れるまで「残りわずかの目安」は出さない', () => {
    setup();

    expect(screen.queryByText('残りわずかの目安')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('残りの数量'), '1.5');

    expect(screen.getByText('残りわずかの目安')).toBeTruthy();
  });

  it('数量と単位と閾値を数値で渡す', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '化成肥料');
    fireEvent.changeText(screen.getByLabelText('残りの数量'), '1.5');
    fireEvent.changeText(screen.getByLabelText('単位'), 'kg');
    fireEvent.changeText(screen.getByLabelText('残りわずかの目安'), '0.5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      quantity: 1.5,
      unit: 'kg',
      lowThreshold: 0.5,
    });
  });

  it('単位はよく使うものから選べる', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '培養土');
    fireEvent.changeText(screen.getByLabelText('残りの数量'), '10');
    fireEvent.press(screen.getByText('L'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].unit).toBe('L');
  });

  it('数量を消すと閾値も渡らない（通知できない設定を残さない）', async () => {
    const { onSubmit } = setup({
      initialValues: { name: '化成肥料', quantity: 1.5, unit: 'kg', lowThreshold: 0.5 },
    });

    fireEvent.changeText(screen.getByLabelText('残りの数量'), '');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ quantity: null, lowThreshold: null });
  });

  it('数量 0 は「数量あり」として扱う', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '化成肥料');
    fireEvent.changeText(screen.getByLabelText('残りの数量'), '0');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].quantity).toBe(0);
    expect(screen.getByText('残りわずかの目安')).toBeTruthy();
  });

  it('通知が 1 日 1 回であることを伝える', () => {
    setup();
    fireEvent.changeText(screen.getByLabelText('残りの数量'), '1');
    expect(screen.getByText(/1 日 1 回、まとめて届きます/)).toBeTruthy();
  });

  it('編集時は値が埋まっている', () => {
    setup({
      initialValues: {
        name: '化成肥料 8-8-8',
        category: 'fertilizer',
        quantity: 1.5,
        unit: 'kg',
        lowThreshold: 0.5,
        note: '開封済み',
      },
    });

    expect(screen.getByDisplayValue('化成肥料 8-8-8')).toBeTruthy();
    expect(screen.getByDisplayValue('1.5')).toBeTruthy();
    expect(screen.getByDisplayValue('kg')).toBeTruthy();
    expect(screen.getByDisplayValue('0.5')).toBeTruthy();
    expect(screen.getByDisplayValue('開封済み')).toBeTruthy();
  });

  it('footer を差し込める（編集画面の削除ボタン）', () => {
    setup({ footer: <>{null}</>, initialValues: { name: '化成肥料' } });
    expect(screen.getByDisplayValue('化成肥料')).toBeTruthy();
  });

  it('キャンセルで onCancel を呼ぶ', () => {
    const { onCancel } = setup();
    fireEvent.press(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('保存中は二重送信しない', async () => {
    let resolve: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<MaterialForm onSubmit={onSubmit} onCancel={jest.fn()} title="資材を追加" />);

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '化成肥料');
    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('保存中')).toBeTruthy());

    fireEvent.press(screen.getByText('保存中'));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolve?.();
    await waitFor(() => expect(screen.getByText('保存')).toBeTruthy());
  });
});

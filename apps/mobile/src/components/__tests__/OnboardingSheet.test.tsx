/**
 * 初回起動の聞き取りのテスト（WBS 3.6）。
 * 見るのは**渡る値**: 既定の中間地・選び直し・任意の菜園名の空白処理。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { OnboardingSheet } from '../OnboardingSheet';

function setup() {
  const onDone = jest.fn(() => Promise.resolve());
  render(<OnboardingSheet onDone={onDone} />);
  return { onDone };
}

describe('OnboardingSheet', () => {
  it('質問は 2 つだけ（名前と地域）で、3 区分が並ぶ', () => {
    setup();

    expect(screen.getByLabelText('菜園の名前')).toBeTruthy();
    expect(screen.getByLabelText('寒冷地')).toBeTruthy();
    expect(screen.getByLabelText('中間地')).toBeTruthy();
    expect(screen.getByLabelText('暖地')).toBeTruthy();
  });

  it('そのまま「はじめる」で中間地・名前なしが渡る', async () => {
    const { onDone } = setup();

    fireEvent.press(screen.getByLabelText('はじめる'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('temperate', ''));
  });

  it('地域を選び直すと選んだ区分が渡る', async () => {
    const { onDone } = setup();

    fireEvent.press(screen.getByLabelText('暖地'));
    fireEvent.press(screen.getByLabelText('はじめる'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('warm', ''));
  });

  it('菜園の名前は前後の空白を落として渡す', async () => {
    const { onDone } = setup();

    fireEvent.changeText(screen.getByLabelText('菜園の名前'), '  ベランダ菜園  ');
    fireEvent.press(screen.getByLabelText('はじめる'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('temperate', 'ベランダ菜園'));
  });

  it('保存中は二重送信しない', async () => {
    let resolve: (() => void) | undefined;
    const onDone = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<OnboardingSheet onDone={onDone} />);

    fireEvent.press(screen.getByLabelText('はじめる'));
    await waitFor(() => expect(screen.getByText('準備中…')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('はじめる'));

    expect(onDone).toHaveBeenCalledTimes(1);
    resolve?.();
    await waitFor(() => expect(screen.getByText('はじめる')).toBeTruthy());
  });
});

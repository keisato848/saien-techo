import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// 読み取りボタンは HarvestFormRead.test が担保。実サービス（usage → 広告 SDK）を
// 読み込ませない
jest.mock('../../services/harvest-read.service', () => ({
  HarvestReadError: class extends Error {},
  readPhotoDirect: jest.fn(),
}));

import { HarvestForm } from '../HarvestForm';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockCapturePhoto = jest.fn();
jest.mock('../../services/photo-capture.service', () => ({
  capturePhoto: (...args: unknown[]) => mockCapturePhoto(...args),
}));
jest.mock('../../services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(() => Promise.resolve(['/saved.jpg'])),
}));
jest.mock('../../services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

describe('HarvestForm', () => {
  beforeEach(() => {
    mockCapturePhoto.mockReset();
    mockCapturePhoto.mockRejectedValue(new Error('cancelled'));
  });

  function setup(props: Partial<React.ComponentProps<typeof HarvestForm>> = {}) {
    const onSubmit = jest.fn(() => Promise.resolve());
    const onCancel = jest.fn();
    render(<HarvestForm onSubmit={onSubmit} onCancel={onCancel} title="収穫を記録" {...props} />);
    return { onSubmit, onCancel };
  }

  it('写真が主役なので、写真が数量より上にある', () => {
    setup();
    // getAllByText の並び順は描画順。写真 → 収穫日 → とれた量 の順であること
    const labels = screen.getAllByText(/写真|収穫日|とれた量/);
    expect(labels[0].props.children).toBe('写真');
  });

  it('数量を入れずに保存できる（任意入力 — R06）', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ quantity: null, photoUris: [] });
  });

  it('入力した数量を数値にして渡す', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByLabelText('とれた量'), '5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].quantity).toBe(5);
  });

  it('小数を保てる（1.5kg）', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByLabelText('とれた量'), '1.5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].quantity).toBe(1.5);
  });

  it('数字以外が混ざっても数値だけ取り出す', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByLabelText('とれた量'), '約3個');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].quantity).toBe(3);
  });

  it('数字が 1 つも無ければ null にする', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByLabelText('とれた量'), 'たくさん');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].quantity).toBeNull();
  });

  it('既定の単位を選んだ状態で開ける', async () => {
    const { onSubmit } = setup({ initialValues: { unit: 'piece' } });

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].unit).toBe('piece');
  });

  it('選択中の単位をもう一度押すと外れる', async () => {
    const { onSubmit } = setup({ initialValues: { unit: 'piece' } });

    fireEvent.press(screen.getByText('個'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].unit).toBeNull();
  });

  it('単位を選び直せる', async () => {
    const { onSubmit } = setup({ initialValues: { unit: 'piece' } });

    fireEvent.press(screen.getByText('kg'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].unit).toBe('kg');
  });

  it('autoCapture のときカメラを開く（3 タップ導線）', async () => {
    setup({ autoCapture: true });
    await waitFor(() => expect(mockCapturePhoto).toHaveBeenCalledTimes(1));
    expect(mockCapturePhoto.mock.calls[0][0]).toBe('camera');
  });

  it('autoCapture でなければカメラを開かない（編集画面で勝手に起動しない）', () => {
    setup();
    expect(mockCapturePhoto).not.toHaveBeenCalled();
  });

  it('撮影を取り消してもフォームに留まる', async () => {
    const { onCancel } = setup({ autoCapture: true });

    await waitFor(() => expect(mockCapturePhoto).toHaveBeenCalled());
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('収穫を記録')).toBeTruthy();
  });

  it('キャンセルで onCancel を呼ぶ', () => {
    const { onCancel } = setup();
    fireEvent.press(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('保存中は二重送信しない', async () => {
    let release: () => void = () => undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<HarvestForm onSubmit={onSubmit} onCancel={jest.fn()} title="収穫を記録" />);

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('保存中')).toBeTruthy());
    fireEvent.press(screen.getByText('保存中'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });
});

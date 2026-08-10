import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { CareLogForm } from '../CareLogForm';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../../services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(),
}));
jest.mock('../../services/photo-capture.service', () => ({ capturePhoto: jest.fn() }));
jest.mock('../../services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

function setup(props: Partial<React.ComponentProps<typeof CareLogForm>> = {}) {
  const onSubmit = jest.fn(() => Promise.resolve());
  const onCancel = jest.fn();
  render(<CareLogForm onSubmit={onSubmit} onCancel={onCancel} title="作業を記録" {...props} />);
  return { onSubmit, onCancel };
}

describe('CareLogForm', () => {
  it('6 種すべてを選べる（クイック記録に無い植え替えも含む）', () => {
    setup();

    for (const label of ['水やり', '追肥', '植え替え', '剪定', '防除', 'その他']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('既定は水やり', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].kind).toBe('water');
  });

  it('種別を選び直せる', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('防除'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].kind).toBe('pest');
  });

  it('メモと写真を渡す', async () => {
    const { onSubmit } = setup({ initialValues: { photoUris: ['/a.jpg'] } });

    fireEvent.changeText(screen.getByPlaceholderText(/うどんこ病/), 'わき芽かき');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      note: 'わき芽かき',
      photoUris: ['/a.jpg'],
    });
  });

  it('編集時は値が埋まっている', () => {
    setup({
      initialValues: { kind: 'prune', note: 'わき芽かき', photoUris: ['/a.jpg', '/b.jpg'] },
    });

    expect(screen.getByDisplayValue('わき芽かき')).toBeTruthy();
    expect(screen.getByText('2 / 6')).toBeTruthy();
  });

  // クイック記録（詳細画面の 5 ボタン）は常に「今」で保存する。
  // 付け忘れた作業や、ギャラリーの古い写真を入れるのはこのフォームの担当
  it('さかのぼりのクイック選択で日付を過去にできる', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('3日前'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const saved = new Date(onSubmit.mock.calls[0][0].loggedAt);
    expect(Math.round((Date.now() - saved.getTime()) / 86_400_000)).toBe(3);
  });

  it('footer に渡した要素を出す（削除ボタンの置き場）', () => {
    render(
      <CareLogForm
        onSubmit={jest.fn(() => Promise.resolve())}
        onCancel={jest.fn()}
        title="記録を編集"
        footer={<Text>削除する</Text>}
      />,
    );

    expect(screen.getByText('削除する')).toBeTruthy();
  });

  it('保存中は二重送信しない', async () => {
    let release: () => void = () => undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<CareLogForm onSubmit={onSubmit} onCancel={jest.fn()} title="作業を記録" />);

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('保存中')).toBeTruthy());
    fireEvent.press(screen.getByText('保存中'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });
});

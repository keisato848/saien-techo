/**
 * HarvestForm の「写真から数量を読み取る」（#143）。
 *
 * 固定するのは:
 * - readCropName が無ければ導線ごと出ない（既存フォームは無変更に見える）
 * - 読み取り結果は数量欄に**入るだけ**（保存はしない — 正はユーザーの確定）
 * - 収穫物が写っていない・数えられない・枠切れは、それぞれの文言で案内する
 * - 送信することの明示（「写真を送って読み取ります」）が常に出る
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('../../services/photo-capture.service', () => ({
  capturePhoto: jest.fn(),
}));
jest.mock('../../services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(() => Promise.resolve(['/saved.jpg'])),
}));
jest.mock('../../services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

const mockReadPhotoDirect = jest.fn();
jest.mock('../../services/harvest-read.service', () => {
  class HarvestReadError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    HarvestReadError,
    readPhotoDirect: (...args: unknown[]) => mockReadPhotoDirect(...args),
  };
});

import { HarvestReadError } from '../../services/harvest-read.service';
import { HarvestForm } from '../HarvestForm';

const noop = () => Promise.resolve();

beforeEach(() => {
  mockReadPhotoDirect.mockReset();
});

describe('HarvestForm の写真読み取り', () => {
  it('readCropName が無ければボタンを出さない', () => {
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
      />,
    );
    expect(screen.queryByText('写真から数量を読み取る')).toBeNull();
  });

  it('写真が無ければボタンを出さない', () => {
    render(
      <HarvestForm onSubmit={noop} onCancel={() => {}} title="収穫を記録" readCropName="トマト" />,
    );
    expect(screen.queryByText('写真から数量を読み取る')).toBeNull();
  });

  it('読み取った個数が数量欄に入り、送信の明示が出ている', async () => {
    mockReadPhotoDirect.mockResolvedValue({
      isHarvest: true,
      cropGuess: 'トマト',
      count: 4,
    });
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
        readCropName="トマト"
      />,
    );

    // 外へ出る操作の明示（#143 の例外 1）
    expect(screen.getByText('写真を送って読み取ります')).toBeTruthy();

    fireEvent.press(screen.getByText('写真から数量を読み取る'));
    await waitFor(() => expect(screen.getByLabelText('とれた量').props.value).toBe('4'));
    expect(mockReadPhotoDirect).toHaveBeenCalledWith('/p.jpg', 'トマト');
    expect(screen.getByText(/違っていたら直してください/)).toBeTruthy();
  });

  it('写真と作物が食い違ったら、その旨を添える', async () => {
    mockReadPhotoDirect.mockResolvedValue({
      isHarvest: true,
      cropGuess: 'ミニトマト',
      count: 8,
    });
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
        readCropName="キュウリ"
      />,
    );
    fireEvent.press(screen.getByText('写真から数量を読み取る'));
    await waitFor(() => expect(screen.getByText(/写真は「ミニトマト」に見えます/)).toBeTruthy());
  });

  it('収穫物が写っていなければ数量は変えず、案内だけ出す', async () => {
    mockReadPhotoDirect.mockResolvedValue({ isHarvest: false });
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
        readCropName="トマト"
      />,
    );
    fireEvent.press(screen.getByText('写真から数量を読み取る'));
    await waitFor(() => expect(screen.getByText(/収穫物が写っていないようです/)).toBeTruthy());
    expect(screen.getByLabelText('とれた量').props.value).toBe('');
  });

  it('数えられなかったら理由を出して手入力に任せる', async () => {
    mockReadPhotoDirect.mockResolvedValue({
      isHarvest: true,
      cropGuess: 'ミニトマト',
      note: '重なっていて数えられませんでした',
    });
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
        readCropName="トマト"
      />,
    );
    fireEvent.press(screen.getByText('写真から数量を読み取る'));
    await waitFor(() => expect(screen.getByText('重なっていて数えられませんでした')).toBeTruthy());
    expect(screen.getByLabelText('とれた量').props.value).toBe('');
  });

  it('枠切れは「まとめて読み取る」への案内を出す', async () => {
    mockReadPhotoDirect.mockRejectedValue(
      new HarvestReadError(
        '今日の読み取りぶんは使い切りました。保存しておくと、あとで「まとめて読み取る」から読めます。',
        'quota',
      ),
    );
    render(
      <HarvestForm
        initialValues={{ photoUris: ['/p.jpg'] }}
        onSubmit={noop}
        onCancel={() => {}}
        title="収穫を記録"
        readCropName="トマト"
      />,
    );
    fireEvent.press(screen.getByText('写真から数量を読み取る'));
    await waitFor(() => expect(screen.getByText(/「まとめて読み取る」から読めます/)).toBeTruthy());
  });
});

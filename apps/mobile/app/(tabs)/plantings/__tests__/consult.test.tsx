/**
 * AI 相談画面（R14/R15 / WBS 3.10・3.11）。
 *
 * 見るのは 3 点:
 * - サービスへ渡る引数（写真・作物名・相談文）
 * - 無料枠の分岐（使い切りで submit が死ぬ / isPlant=false は枠を消費しない）
 * - 結果と免責の表示
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockRouter = { back: mockBack, push: mockPush };
let mockParams: Record<string, string> = { id: 'p1' };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlantingDetail = jest.fn();
jest.mock('../../../../src/services/planting.service', () => ({
  getPlantingDetail: (...args: unknown[]) => mockGetPlantingDetail(...args),
}));

const mockGetFreemiumStatus = jest.fn();
const mockRecordCloudInference = jest.fn(() => Promise.resolve());
const mockGrantAdBonus = jest.fn(() => Promise.resolve(1));
jest.mock('../../../../src/services/usage.service', () => ({
  getFreemiumStatus: (...args: unknown[]) => mockGetFreemiumStatus(...args),
  recordCloudInference: (...args: unknown[]) => mockRecordCloudInference(...args),
  grantAdBonus: (...args: unknown[]) => mockGrantAdBonus(...args),
}));

const mockShowRewardedAd = jest.fn();
jest.mock('../../../../src/services/ad-reward.service', () => ({
  getAdRewardProvider: () => ({ showRewardedAd: mockShowRewardedAd }),
}));

const mockConsultGarden = jest.fn();
jest.mock('../../../../src/services/garden-consult.service', () => ({
  ...jest.requireActual('../../../../src/services/garden-consult.service'),
  consultGarden: (...args: unknown[]) => mockConsultGarden(...args),
}));

const mockCapturePhoto = jest.fn();
jest.mock('../../../../src/services/photo-capture.service', () => ({
  capturePhoto: (...args: unknown[]) => mockCapturePhoto(...args),
}));
jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

import GardenConsultScreen from '../[id]/consult';
// factory が requireActual を通しているので、これは本物のクラス
import { GardenConsultError } from '../../../../src/services/garden-consult.service';

const PLANTING = {
  id: 'p1',
  cropName: 'ミニトマト',
  variety: 'アイコ',
  elapsedDays: 42,
};

const STATUS_OK = {
  isPremium: false,
  isByok: false,
  used: 0,
  limit: 1,
  remaining: 1,
  canInfer: true,
  canWatchAdForMore: false,
  adBonusGranted: 0,
  adBonusLimit: 3,
};

beforeEach(() => {
  mockParams = { id: 'p1' };
  mockBack.mockReset();
  mockPush.mockReset();
  mockGetPlantingDetail.mockReset().mockResolvedValue(PLANTING);
  mockGetFreemiumStatus.mockReset().mockResolvedValue(STATUS_OK);
  mockRecordCloudInference.mockReset().mockResolvedValue(undefined);
  mockGrantAdBonus.mockReset().mockResolvedValue(1);
  mockShowRewardedAd.mockReset();
  mockConsultGarden.mockReset();
  mockCapturePhoto.mockReset();
});

async function pickPhoto() {
  mockCapturePhoto.mockResolvedValue({ localPath: 'file:///tmp/leaf.jpg' });
  fireEvent.press(await screen.findByLabelText('ギャラリーから選ぶ'));
  // capturePhoto の解決だけでは state 反映前にボタンを押してしまう。
  // プレビュー（削除バッジ）が出る = imageUri がセットされた、を待つ
  await screen.findByLabelText('写真を削除');
}

describe('AI 相談画面', () => {
  it('写真・作物名・相談文をサービスへ渡し、成功で枠を消費する', async () => {
    mockConsultGarden.mockResolvedValue({
      isPlant: true,
      plantGuess: 'ミニトマト',
      plantConfidence: 'medium',
      healthStatus: 'concern',
      issues: [{ name: '窒素不足', likelihood: 'medium', signs: '下葉から黄化' }],
      advice: ['追肥を検討してください'],
    });

    render(<GardenConsultScreen />);
    await screen.findByText(/ミニトマト（アイコ）/);
    await pickPhoto();

    fireEvent.changeText(screen.getByPlaceholderText('例: 下葉が黄色くなってきた'), '下葉が黄色い');
    fireEvent.press(screen.getByLabelText('AI に相談する'));

    await waitFor(() =>
      expect(mockConsultGarden).toHaveBeenCalledWith({
        imageUri: 'file:///tmp/leaf.jpg',
        cropName: 'ミニトマト',
        question: '下葉が黄色い',
      }),
    );
    await screen.findByText('窒素不足');
    expect(screen.getByText('・追肥を検討してください')).toBeTruthy();
    expect(mockRecordCloudInference).toHaveBeenCalledTimes(1);
    // 免責（Q5）は常時表示
    expect(screen.getByText(/製品ラベルの記載と関係法令/)).toBeTruthy();
  });

  it('写真を選ぶまで相談ボタンは押せない', async () => {
    render(<GardenConsultScreen />);
    await screen.findByText(/ミニトマト/);

    fireEvent.press(screen.getByLabelText('AI に相談する'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockConsultGarden).not.toHaveBeenCalled();
  });

  it('無料枠を使い切ると相談できず、案内を出す', async () => {
    mockGetFreemiumStatus.mockResolvedValue({
      ...STATUS_OK,
      used: 1,
      remaining: 0,
      canInfer: false,
    });

    render(<GardenConsultScreen />);
    await screen.findByText(/今日の相談はここまでです/);
    await pickPhoto();

    fireEvent.press(screen.getByLabelText('AI に相談する'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockConsultGarden).not.toHaveBeenCalled();
  });

  it('植物が写っていない判定は枠を消費しない', async () => {
    mockConsultGarden.mockResolvedValue({ isPlant: false });

    render(<GardenConsultScreen />);
    await screen.findByText(/ミニトマト/);
    await pickPhoto();
    fireEvent.press(screen.getByLabelText('AI に相談する'));

    await screen.findByText(/植物が写っていないようです/);
    expect(mockRecordCloudInference).not.toHaveBeenCalled();
  });

  it('サービスのエラーはメッセージをそのまま出す', async () => {
    mockConsultGarden.mockRejectedValue(
      new GardenConsultError('本日の利用上限に達しました。', false, 'rate_limited'),
    );

    render(<GardenConsultScreen />);
    await screen.findByText(/ミニトマト/);
    await pickPhoto();
    fireEvent.press(screen.getByLabelText('AI に相談する'));

    await screen.findByText('本日の利用上限に達しました。');
    expect(mockRecordCloudInference).not.toHaveBeenCalled();
  });

  it('枠切れ + 広告ありなら動画ボタンが出て、視聴完了でボーナスを付与する', async () => {
    mockGetFreemiumStatus
      .mockResolvedValueOnce({
        ...STATUS_OK,
        used: 1,
        remaining: 0,
        canInfer: false,
        canWatchAdForMore: true,
      })
      // 視聴完了後の再取得では +1 されている
      .mockResolvedValue({ ...STATUS_OK, used: 1, limit: 2, remaining: 1, adBonusGranted: 1 });
    mockShowRewardedAd.mockResolvedValue({ rewarded: true });

    render(<GardenConsultScreen />);
    fireEvent.press(await screen.findByLabelText('動画を見てもう1回相談する'));

    await waitFor(() => expect(mockGrantAdBonus).toHaveBeenCalledTimes(1));
    // 付与後は枠が復活し、残り回数の表示に戻る
    await screen.findByText('今日はあと 1 回相談できます');
  });

  it('動画を途中で閉じたらボーナスを付与しない', async () => {
    mockGetFreemiumStatus.mockResolvedValue({
      ...STATUS_OK,
      used: 1,
      remaining: 0,
      canInfer: false,
      canWatchAdForMore: true,
    });
    mockShowRewardedAd.mockResolvedValue({ rewarded: false });

    render(<GardenConsultScreen />);
    fireEvent.press(await screen.findByLabelText('動画を見てもう1回相談する'));

    await waitFor(() => expect(mockShowRewardedAd).toHaveBeenCalled());
    expect(mockGrantAdBonus).not.toHaveBeenCalled();
  });

  it('広告が出せないときは動画ボタン自体を出さない', async () => {
    mockGetFreemiumStatus.mockResolvedValue({
      ...STATUS_OK,
      used: 1,
      remaining: 0,
      canInfer: false,
      canWatchAdForMore: false,
    });

    render(<GardenConsultScreen />);
    await screen.findByText(/また明日お試しください/);
    expect(screen.queryByLabelText('動画を見てもう1回相談する')).toBeNull();
  });

  it('結果から作業ログの記録へ進める', async () => {
    mockConsultGarden.mockResolvedValue({ isPlant: true, plantGuess: 'キュウリ' });

    render(<GardenConsultScreen />);
    await screen.findByText(/ミニトマト/);
    await pickPhoto();
    fireEvent.press(screen.getByLabelText('AI に相談する'));
    await screen.findByTestId('consult-result');

    fireEvent.press(screen.getByLabelText('作業ログに記録する'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new');
  });
});

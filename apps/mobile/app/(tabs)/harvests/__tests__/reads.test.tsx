/**
 * 「写真の読み取り」画面（#143 / #144）。
 *
 * ここで固定するのは**金の動く順序**:
 * - 動画が最後まで再生されなかったら、印も付けず 1 件も送らない
 * - 視聴完了ではじめて markPaidForReward → processPaidReads の順に動く
 * - 無料枠が無ければ無料ボタンを出さない
 * 結果の確認（記録する / しない）がサービスへ正しく届くことも見る。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { HarvestReadItem } from '../../../../src/services/harvest-read.service';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetReadQueue = jest.fn();
const mockGrantFreeRead = jest.fn();
const mockMarkPaidForReward = jest.fn();
const mockProcessPaidReads = jest.fn();
const mockApplyRead = jest.fn();
const mockDismissRead = jest.fn();
jest.mock('../../../../src/services/harvest-read.service', () => ({
  READS_PER_REWARD: 10,
  getReadQueue: (...args: unknown[]) => mockGetReadQueue(...args),
  grantFreeRead: (...args: unknown[]) => mockGrantFreeRead(...args),
  markPaidForReward: (...args: unknown[]) => mockMarkPaidForReward(...args),
  processPaidReads: (...args: unknown[]) => mockProcessPaidReads(...args),
  applyRead: (...args: unknown[]) => mockApplyRead(...args),
  dismissRead: (...args: unknown[]) => mockDismissRead(...args),
}));

const mockShowRewardedAd = jest.fn();
let mockAdAvailable = true;
jest.mock('../../../../src/services/ad-reward.service', () => ({
  getAdRewardProvider: () => ({ showRewardedAd: mockShowRewardedAd }),
  isAdRewardAvailable: () => mockAdAvailable,
}));

let mockCanInfer = true;
jest.mock('../../../../src/services/usage.service', () => ({
  getFreemiumStatus: () => Promise.resolve({ canInfer: mockCanInfer }),
}));

import HarvestReadsScreen from '../reads';

function item(overrides: Partial<HarvestReadItem> & { harvestId: string }): HarvestReadItem {
  return {
    plantingId: 'p1',
    cropName: 'キュウリ',
    harvestedAt: '2026-08-19T09:00:00.000Z',
    photoUri: null,
    state: 'pending',
    paid: false,
    attempts: 0,
    cropGuess: null,
    count: null,
    readNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdAvailable = true;
  mockCanInfer = true;
  mockGetReadQueue.mockResolvedValue([]);
  mockProcessPaidReads.mockResolvedValue({ processed: 0, failed: 0 });
  mockGrantFreeRead.mockResolvedValue('h1');
  mockMarkPaidForReward.mockResolvedValue(['h1']);
});

describe('HarvestReadsScreen', () => {
  it('待ちが無ければ空状態を出す', async () => {
    render(<HarvestReadsScreen />);
    await waitFor(() => expect(screen.getByText('読み取り待ちはありません')).toBeTruthy());
  });

  it('動画が最後まで再生されなかったら、印も付けず 1 件も送らない', async () => {
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1' }), item({ harvestId: 'h2' })]);
    mockShowRewardedAd.mockResolvedValue({ rewarded: false });

    render(<HarvestReadsScreen />);
    const button = await screen.findByText('動画を見て 2 枚を読み取る');
    fireEvent.press(button);

    await waitFor(() => expect(screen.getByText(/最後まで再生されませんでした/)).toBeTruthy());
    expect(mockMarkPaidForReward).not.toHaveBeenCalled();
    expect(mockProcessPaidReads).not.toHaveBeenCalled();
  });

  it('視聴完了で 印 → 処理 の順に動く', async () => {
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1' })]);
    mockShowRewardedAd.mockResolvedValue({ rewarded: true });

    render(<HarvestReadsScreen />);
    fireEvent.press(await screen.findByText('動画を見て 1 枚を読み取る'));

    await waitFor(() => expect(mockProcessPaidReads).toHaveBeenCalled());
    expect(mockMarkPaidForReward).toHaveBeenCalledTimes(1);
    // 印 → 処理 の順（逆だと「支払っていないものを送る」余地ができる）
    expect(mockMarkPaidForReward.mock.invocationCallOrder[0]).toBeLessThan(
      mockProcessPaidReads.mock.invocationCallOrder[0],
    );
  });

  it('ボタンの枚数はキューの実数（上限 10）', async () => {
    mockGetReadQueue.mockResolvedValue(
      Array.from({ length: 13 }, (_, i) => item({ harvestId: `h${i}` })),
    );
    render(<HarvestReadsScreen />);
    // 「全部」とは言わない（AdMob の開示要件 — #144）
    await screen.findByText('動画を見て 10 枚を読み取る');
  });

  it('広告が出せない環境ではリワードボタンを出さない', async () => {
    mockAdAvailable = false;
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1' })]);
    render(<HarvestReadsScreen />);
    await screen.findByText('読み取り待ち');
    expect(screen.queryByText(/動画を見て/)).toBeNull();
  });

  it('無料枠が無ければ無料ボタンを出さない', async () => {
    mockCanInfer = false;
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1' })]);
    render(<HarvestReadsScreen />);
    await screen.findByText('読み取り待ち');
    expect(screen.queryByText(/今日のぶんを 1 枚読み取る/)).toBeNull();
  });

  it('無料ボタンは grantFreeRead → processPaidReads の順に動く', async () => {
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1' })]);
    render(<HarvestReadsScreen />);
    fireEvent.press(await screen.findByText(/今日のぶんを 1 枚読み取る/));

    await waitFor(() => expect(mockProcessPaidReads).toHaveBeenCalled());
    expect(mockGrantFreeRead).toHaveBeenCalledTimes(1);
    expect(mockGrantFreeRead.mock.invocationCallOrder[0]).toBeLessThan(
      mockProcessPaidReads.mock.invocationCallOrder[0],
    );
  });

  it('paid の残りがあれば開いた時に自動で読み切る（リワードの履行）', async () => {
    mockGetReadQueue.mockResolvedValue([item({ harvestId: 'h1', paid: true })]);
    render(<HarvestReadsScreen />);
    await waitFor(() => expect(mockProcessPaidReads).toHaveBeenCalled());
    // 自動再開に新しい支払いは要らない
    expect(mockMarkPaidForReward).not.toHaveBeenCalled();
    expect(mockShowRewardedAd).not.toHaveBeenCalled();
  });

  it('読み取り結果は確認を挟み、「記録する」で applyRead が呼ばれる', async () => {
    mockGetReadQueue.mockResolvedValue([
      item({ harvestId: 'h1', state: 'analyzed', cropGuess: 'ミニトマト', count: 8 }),
    ]);
    render(<HarvestReadsScreen />);

    await screen.findByText('ミニトマト 8 個 — 合っていますか？');
    fireEvent.press(screen.getByText('記録する'));
    await waitFor(() => expect(mockApplyRead).toHaveBeenCalledWith('h1'));
  });

  it('「しない」で dismissRead、「直す」で編集画面へ', async () => {
    mockGetReadQueue.mockResolvedValue([
      item({ harvestId: 'h1', plantingId: 'p9', state: 'analyzed', cropGuess: 'ナス', count: 2 }),
    ]);
    render(<HarvestReadsScreen />);
    await screen.findByText('ナス 2 個 — 合っていますか？');

    fireEvent.press(screen.getByText('直す'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h1');

    fireEvent.press(screen.getByText('しない'));
    await waitFor(() => expect(mockDismissRead).toHaveBeenCalledWith('h1'));
  });

  it('数えられなかった結果は理由を見せて手入力へ誘導する', async () => {
    mockGetReadQueue.mockResolvedValue([
      item({
        harvestId: 'h1',
        state: 'analyzed',
        readNote: '重なっていて数えられませんでした',
      }),
    ]);
    render(<HarvestReadsScreen />);
    await screen.findByText('重なっていて数えられませんでした');
    expect(screen.getByText('数量を入力')).toBeTruthy();
    expect(screen.queryByText(/合っていますか/)).toBeNull();
  });
});

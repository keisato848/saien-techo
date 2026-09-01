/**
 * 写真から栽培をまとめて登録する画面（#139 / #149）。
 *
 * 画面テストで見張るのは分岐と遷移:
 * - 残高が無いときに動画を勧め、視聴完了でだけ残高を足す
 * - 推定は必ず直せる（正はユーザーの確定 — #139 の共通の作法）
 * - 写真が使えなくても手入力へ抜けられる（行き止まりにしない）
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { useEffect as reactUseEffect } from 'react';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = jest.requireActual('react') as { useEffect: typeof reactUseEffect };
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));

const mockCapturePhotos = jest.fn();
jest.mock('../../../../src/services/photo-capture.service', () => {
  class PhotoCaptureCancelledError extends Error {}
  return {
    PhotoCaptureCancelledError,
    capturePhotos: (...args: unknown[]) => mockCapturePhotos(...args),
  };
});

jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

const mockIdentifyBatch = jest.fn();
const mockRegistrable = jest.fn();
jest.mock('../../../../src/services/planting-draft.service', () => ({
  MAX_IDENTIFY_BATCH: 10,
  identifyPhotoBatch: (...args: unknown[]) => mockIdentifyBatch(...args),
  registrableDrafts: (...args: unknown[]) => mockRegistrable(...args),
}));

let mockCredits = 0;
const mockGrant = jest.fn();
jest.mock('../../../../src/services/identify-credit.service', () => ({
  IDENTIFY_PER_REWARD: 5,
  getIdentifyCredits: () => Promise.resolve(mockCredits),
  grantIdentifyCredits: (...args: unknown[]) => mockGrant(...args),
}));

let mockAdAvailable = true;
const mockShowRewardedAd = jest.fn();
jest.mock('../../../../src/services/ad-reward.service', () => ({
  isAdRewardAvailable: () => mockAdAvailable,
  getAdRewardProvider: () => ({ showRewardedAd: () => mockShowRewardedAd() }),
}));

const mockCreatePlanting = jest.fn();
jest.mock('../../../../src/services/planting.service', () => ({
  createPlanting: (...args: unknown[]) => mockCreatePlanting(...args),
}));

import IdentifyPlantingScreen from '../identify';

beforeEach(() => {
  mockCredits = 0;
  mockAdAvailable = true;
  mockReplace.mockReset();
  mockBack.mockReset();
  mockCapturePhotos.mockReset();
  mockIdentifyBatch.mockReset();
  mockGrant.mockReset().mockResolvedValue(5);
  mockShowRewardedAd.mockReset();
  mockCreatePlanting.mockReset().mockResolvedValue('p1');
  mockRegistrable.mockImplementation((drafts: { cropName?: string }[]) =>
    drafts.filter((d) => Boolean(d.cropName?.trim())),
  );
});

describe('写真から登録', () => {
  it('残高が無いときは動画の導線を出す', async () => {
    render(<IdentifyPlantingScreen />);
    await waitFor(() =>
      expect(screen.getByText('動画を 1 本見ると 5 枚 読み取れます')).toBeTruthy(),
    );
    expect(screen.getByLabelText('動画を見て 5 枚を読み取る')).toBeTruthy();
  });

  it('残高があるときは残り枚数を出す', async () => {
    mockCredits = 3;
    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByText('あと 3 枚 読み取れます')).toBeTruthy());
  });

  // 広告が出せない端末で行き止まりにしない
  it('広告が出せないときは動画ボタンを出さない', async () => {
    mockAdAvailable = false;
    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    expect(screen.queryByLabelText('動画を見て 5 枚を読み取る')).toBeNull();
  });

  it('選んだ写真を読み取って下書きを並べる', async () => {
    mockCredits = 2;
    mockCapturePhotos.mockResolvedValue([{ localPath: 'a.jpg' }, { localPath: 'b.jpg' }]);
    mockIdentifyBatch.mockResolvedValue([
      { imageUri: 'a.jpg', state: 'identified', cropName: 'ミニトマト', variety: 'アイコ' },
      { imageUri: 'b.jpg', state: 'identified', cropName: 'キュウリ' },
    ]);

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));

    await waitFor(() => expect(screen.getByDisplayValue('ミニトマト')).toBeTruthy());
    expect(screen.getByDisplayValue('アイコ')).toBeTruthy();
    expect(screen.getByDisplayValue('キュウリ')).toBeTruthy();
    expect(screen.getByLabelText('2 件を登録する')).toBeTruthy();
  });

  // 視聴を途中で閉じたら残高を足さない（#143 の不変条件と同じ）
  it('動画を途中で閉じたら残高を足さない', async () => {
    mockShowRewardedAd.mockResolvedValue({ rewarded: false });

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('動画を見て 5 枚を読み取る')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('動画を見て 5 枚を読み取る'));

    await waitFor(() => expect(mockShowRewardedAd).toHaveBeenCalled());
    expect(mockGrant).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText('動画が最後まで再生されませんでした。もう一度お試しください。'),
      ).toBeTruthy(),
    );
  });

  it('視聴完了でだけ残高を足す', async () => {
    mockShowRewardedAd.mockResolvedValue({ rewarded: true });

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('動画を見て 5 枚を読み取る')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('動画を見て 5 枚を読み取る'));

    await waitFor(() => expect(mockGrant).toHaveBeenCalled());
  });

  // 推定は必ず直せる。正はユーザーの確定（#139 の共通の作法）
  it('推定された作物名を直して登録できる', async () => {
    mockCredits = 1;
    mockCapturePhotos.mockResolvedValue([{ localPath: 'a.jpg' }]);
    mockIdentifyBatch.mockResolvedValue([
      { imageUri: 'a.jpg', state: 'identified', cropName: 'ミニトマト' },
    ]);

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await waitFor(() => expect(screen.getByDisplayValue('ミニトマト')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('ミニトマト'), 'トマト');
    fireEvent.press(screen.getByLabelText('1 件を登録する'));

    await waitFor(() => expect(mockCreatePlanting).toHaveBeenCalled());
    expect(mockCreatePlanting).toHaveBeenCalledWith(
      expect.objectContaining({ cropName: 'トマト' }),
    );
  });

  it('読み取れなかった写真は消せる', async () => {
    mockCredits = 1;
    mockCapturePhotos.mockResolvedValue([{ localPath: 'a.jpg' }]);
    mockIdentifyBatch.mockResolvedValue([
      { imageUri: 'a.jpg', state: 'failed', errorMessage: '作物を読み取れませんでした。' },
    ]);

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await waitFor(() => expect(screen.getByText('作物を読み取れませんでした。')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この写真をやめる'));
    await waitFor(() => expect(screen.queryByText('作物を読み取れませんでした。')).toBeNull());
  });

  // 写真が使えない人を行き止まりにしない（#139 の共通の作法）
  it('手入力の登録へ抜けられる', async () => {
    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('手で入力して登録する')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('手で入力して登録する'));
    expect(mockReplace).toHaveBeenCalledWith('/plantings/new');
  });

  it('残高が足りないぶんは動画で読み取れる・作物名を入れれば先に登録できると案内する', async () => {
    mockCredits = 1;
    mockCapturePhotos.mockResolvedValue([{ localPath: 'a.jpg' }, { localPath: 'b.jpg' }]);
    mockIdentifyBatch.mockResolvedValue([
      { imageUri: 'a.jpg', state: 'identified', cropName: 'トマト' },
      { imageUri: 'b.jpg', state: 'pending' },
    ]);

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));

    await waitFor(() =>
      expect(
        screen.getByText(
          '残り 1 枚は動画を見ると読み取れます。作物名を入力すれば、その写真だけ先に登録できます。',
        ),
      ).toBeTruthy(),
    );
  });
});

/** 描画結果に現れる文字列を、画面上の順に並べて返す（app/(tabs)/__tests__/home.test.tsx と同じ作法） */
function renderedTexts(): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object' && 'children' in node) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return found;
}

function orderOf(...labels: string[]): number[] {
  const texts = renderedTexts();
  return labels.map((label) => texts.findIndex((text) => text.includes(label)));
}

describe('ボタンの並び', () => {
  // 残高 0 の利用者が「写真を選ぶ」を先に押し、選んだ写真が全部 pending のまま
  // 進めなくなった実績があるため、残高 0 のときは動画ボタンを先に出す（2026-09-01）
  it('残高が無いときは動画を見るボタンを写真を選ぶより先に出す', async () => {
    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('動画を見て 5 枚を読み取る')).toBeTruthy());

    const [reward, primary] = orderOf('動画を見て 5 枚を読み取る', '写真を選ぶ');
    expect(reward).toBeGreaterThanOrEqual(0);
    expect(primary).toBeGreaterThanOrEqual(0);
    expect(reward).toBeLessThan(primary);
  });

  it('残高があるときは写真を選ぶボタンの順番を変えない', async () => {
    mockCredits = 1;
    mockCapturePhotos.mockResolvedValue([{ localPath: 'a.jpg' }, { localPath: 'b.jpg' }]);
    mockIdentifyBatch.mockResolvedValue([
      { imageUri: 'a.jpg', state: 'identified', cropName: 'トマト' },
      { imageUri: 'b.jpg', state: 'pending' },
    ]);

    render(<IdentifyPlantingScreen />);
    await waitFor(() => expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));

    // pending が残るので動画ボタンも出る（残高は 1 のまま = credits > 0）
    await waitFor(() => expect(screen.getByLabelText('動画を見て 5 枚を読み取る')).toBeTruthy());

    const [primary, reward] = orderOf('写真を選ぶ', '動画を見て 5 枚を読み取る');
    expect(primary).toBeGreaterThanOrEqual(0);
    expect(reward).toBeGreaterThanOrEqual(0);
    expect(primary).toBeLessThan(reward);
  });
});

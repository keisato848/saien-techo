/**
 * 収穫カードの共有画面（R28 / WBS 4.10 / #41）。
 *
 * この画面で守りたいのは 3 つ。
 *
 * 1. **画面を開いただけでは何も外へ出ない。** 共有シートは押したときだけ開く
 * 2. **カードへ焼き込むのは位置情報を落とした写真だけ。** 原本は渡さない
 * 3. **写真が描かれる前に書き出させない。** Android の RNSVG は読み込み前だと
 *    写真の抜けたカードを吐く（harvest-share.service.ts 冒頭）。
 *    そのまま時間切れになったら、ことばだけのカードへ落として先へ進ませる
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { HarvestShareCard } from '../../../../src/services/harvest-share.service';

const mockBack = jest.fn();
const mockRouter = { back: mockBack, push: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockGetHarvestShareCard = jest.fn();
const mockPrepareSharePhoto = jest.fn();
const mockShareHarvestCard = jest.fn();
const mockCaptureShareCard = jest.fn();
jest.mock('../../../../src/services/harvest-share.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest-share.service'),
  getHarvestShareCard: (...args: unknown[]) => mockGetHarvestShareCard(...args),
  prepareSharePhoto: (...args: unknown[]) => mockPrepareSharePhoto(...args),
  shareHarvestCard: (...args: unknown[]) => mockShareHarvestCard(...args),
  captureShareCard: (...args: unknown[]) => mockCaptureShareCard(...args),
}));

import ShareHarvestScreen, { PHOTO_LOAD_TIMEOUT_MS } from '../[id]/harvests/share';

const ORIGINAL_PHOTO = 'file:///documents/garden-photos/a.jpg';
const SAFE_PHOTO = 'file:///cache/ImageManipulator/safe.jpg';

function card(overrides: Partial<HarvestShareCard> = {}): HarvestShareCard {
  return {
    harvestId: 'h1',
    plantingId: 'p1',
    cropName: 'キュウリ',
    variety: null,
    harvestedAt: '2026-09-07T02:00:00.000Z',
    quantity: 3,
    unit: 'piece',
    photoUri: ORIGINAL_PHOTO,
    photoCount: 1,
    ...overrides,
  };
}

/** 写真が Fresco に載った合図。ここまで来て初めて書き出してよい */
async function letPhotoLoad(): Promise<void> {
  const photo = await screen.findByTestId('harvest-share-photo');
  fireEvent(photo, 'load');
  await screen.findByText('カードを共有');
}

beforeEach(() => {
  mockBack.mockReset();
  mockRouter.push.mockReset();
  mockParams = { id: 'p1', harvestId: 'h1' };
  mockGetHarvestShareCard.mockReset().mockResolvedValue(card());
  mockPrepareSharePhoto.mockReset().mockResolvedValue(SAFE_PHOTO);
  mockShareHarvestCard.mockReset().mockResolvedValue('card');
  mockCaptureShareCard.mockReset().mockResolvedValue('BASE64');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('収穫を共有', () => {
  it('開いただけでは共有シートを開かない', async () => {
    render(<ShareHarvestScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByTestId('harvest-share-card')).toBeTruthy(), {
      timeout: 20_000,
    });
    expect(mockShareHarvestCard).not.toHaveBeenCalled();
  });

  /**
   * ここが安全側の要。プレビューへ載せた uri がそのまま書き出しの素材になるので、
   * 原本を渡すと GPS 座標の付いた画素がカードへ焼き込まれて外へ出る。
   */
  it('位置情報を落とした写真だけをカードへ載せる', async () => {
    render(<ShareHarvestScreen />);

    await waitFor(() => expect(mockPrepareSharePhoto).toHaveBeenCalledWith(ORIGINAL_PHOTO));
    const photo = await screen.findByTestId('harvest-share-photo');
    expect(photo.props.src).toMatchObject({ uri: SAFE_PHOTO });
  });

  // 読み込み前に書き出すと写真の抜けたカードになる
  it('写真が描かれるまで共有を押させない', async () => {
    render(<ShareHarvestScreen />);

    await screen.findByText('写真を読み込んでいます');
    fireEvent.press(screen.getByLabelText('カードを共有する'));
    expect(mockShareHarvestCard).not.toHaveBeenCalled();

    await letPhotoLoad();
    fireEvent.press(screen.getByLabelText('カードを共有する'));
    await waitFor(() => expect(mockShareHarvestCard).toHaveBeenCalled());
  });

  it('カードを共有すると、書き出しの手を渡して共有シートを開く', async () => {
    render(<ShareHarvestScreen />);
    await letPhotoLoad();

    fireEvent.press(screen.getByLabelText('カードを共有する'));

    await waitFor(() => expect(mockShareHarvestCard).toHaveBeenCalled());
    const [passedCard, options] = mockShareHarvestCard.mock.calls[0] as [
      HarvestShareCard,
      { textOnly?: boolean; captureCard?: () => Promise<string | null> },
    ];
    expect(passedCard.harvestId).toBe('h1');
    expect(options.textOnly).toBeUndefined();
    // 書き出しは画面の SVG から取る（サービスは自分で描かない）
    await options.captureCard?.();
    expect(mockCaptureShareCard).toHaveBeenCalled();
  });

  it('ことばだけ共有は書き出しを頼まない', async () => {
    render(<ShareHarvestScreen />);
    await letPhotoLoad();

    fireEvent.press(screen.getByLabelText('ことばだけ共有する'));

    await waitFor(() => expect(mockShareHarvestCard).toHaveBeenCalled());
    expect(mockShareHarvestCard.mock.calls[0][1]).toEqual({ textOnly: true });
  });

  /**
   * 送ったつもりで送れていない事故を防ぐ。カードが出せずことばへ落ちたことは
   * 必ず伝える（黙って落とさない）。
   */
  it('カードを書き出せずことばへ落ちたら伝える', async () => {
    mockShareHarvestCard.mockResolvedValue('text');
    render(<ShareHarvestScreen />);
    await letPhotoLoad();

    fireEvent.press(screen.getByLabelText('カードを共有する'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'カードを書き出せませんでした',
        expect.stringContaining('ことばだけ'),
      ),
    );
  });

  it('ことばだけ共有のときは落ちたと言わない', async () => {
    mockShareHarvestCard.mockResolvedValue('text');
    render(<ShareHarvestScreen />);
    await letPhotoLoad();

    fireEvent.press(screen.getByLabelText('ことばだけ共有する'));

    await waitFor(() => expect(mockShareHarvestCard).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  /**
   * `onLoad` が来ないまま止まると、押せないボタンの前で詰む。
   * 時間切れで写真を諦め、ことばだけのカードとして共有できるようにする。
   */
  it('写真が描かれないまま時間切れならことばだけのカードへ落とす', async () => {
    jest.useFakeTimers();
    try {
      render(<ShareHarvestScreen />);
      await waitFor(() => expect(screen.getByText('写真を読み込んでいます')).toBeTruthy());

      act(() => {
        jest.advanceTimersByTime(PHOTO_LOAD_TIMEOUT_MS);
      });

      expect(screen.getByText('カードを共有')).toBeTruthy();
      expect(screen.queryByTestId('harvest-share-photo')).toBeNull();
      expect(screen.getByText(/写真を読み込めませんでした/)).toBeTruthy();
    } finally {
      // 偽タイマーのまま残った予約（Animated など）を捨ててから戻す。
      // 残すとワーカーが終われず「force exited」の警告になる
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('位置情報を落とせなかった写真は載せずに、その旨を伝える', async () => {
    mockPrepareSharePhoto.mockResolvedValue(null);
    render(<ShareHarvestScreen />);

    await screen.findByText(/写真を読み込めませんでした/);
    expect(screen.queryByTestId('harvest-share-photo')).toBeNull();
    // 写真が無くてもカードは共有できる
    expect(screen.getByText('カードを共有')).toBeTruthy();
  });

  // 写真の無い収穫（数量だけ）も R06 の正常系
  it('写真の無い収穫はことばだけのカードとして共有できる', async () => {
    mockGetHarvestShareCard.mockResolvedValue(card({ photoUri: null, photoCount: 0 }));
    render(<ShareHarvestScreen />);

    await screen.findByText(/写真がないので/);
    expect(mockPrepareSharePhoto).not.toHaveBeenCalled();
    expect(screen.getByText('カードを共有')).toBeTruthy();
  });

  it('写真が複数あれば 1 枚目だけだと伝える', async () => {
    mockGetHarvestShareCard.mockResolvedValue(card({ photoCount: 3 }));
    render(<ShareHarvestScreen />);

    await letPhotoLoad();
    expect(screen.getByText(/1 枚目だけ/)).toBeTruthy();
  });

  it('見つからない収穫は空状態を出す', async () => {
    mockGetHarvestShareCard.mockResolvedValue(null);
    render(<ShareHarvestScreen />);

    await screen.findByText('この収穫は見つかりませんでした');
    fireEvent.press(screen.getByText('戻る'));
    expect(mockBack).toHaveBeenCalled();
  });
});

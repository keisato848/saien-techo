/**
 * 収穫アルバムの画面テスト（R07 / WBS 2.2）。
 *
 * このアルバムは**写真 1 枚が 1 マス**で、写真の無い収穫もマスとして出す。
 * 「写真だけ並べる」に戻すと、数量だけ記録した収穫が一覧から静かに消える。
 * 絞り込みの往復（作物チップ・栽培詳細からの plantingId）も、
 * 引数をサービスへ渡し損ねても画面は「0 件」に見えるだけなので、ここで固定する。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { HarvestPhotoCell } from '../../../../src/services/types';

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

// 画面に埋めた「写真の読み取り」カードが実 DB を叩かないように
jest.mock('../../../../src/services/harvest-read.service', () => ({
  getOpenReadCount: () => Promise.resolve(0),
}));

const mockGetHarvestAlbum = jest.fn();
const mockGetHarvestCropNames = jest.fn();
jest.mock('../../../../src/services/harvest.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest.service'),
  getHarvestAlbum: (...args: unknown[]) => mockGetHarvestAlbum(...args),
  getHarvestCropNames: (...args: unknown[]) => mockGetHarvestCropNames(...args),
}));

import HarvestAlbumScreen from '../index';

const THIS_YEAR = new Date().getFullYear();

/** 端末のタイムゾーンで月を束ねる実装に合わせ、ローカル時刻で作る */
function localIso(year: number, month1: number, day: number): string {
  return new Date(year, month1 - 1, day, 12, 0, 0).toISOString();
}

function cell(overrides: Partial<HarvestPhotoCell> & { key: string }): HarvestPhotoCell {
  return {
    harvestId: 'h1',
    plantingId: 'p1',
    cropName: 'トマト',
    harvestedAt: localIso(THIS_YEAR, 8, 10),
    quantity: null,
    unit: null,
    photoUri: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockParams = {};
  mockGetHarvestAlbum.mockReset().mockResolvedValue([]);
  mockGetHarvestCropNames.mockReset().mockResolvedValue([]);
});

describe('収穫アルバム — 並べ方', () => {
  it('1 件も無ければ記録の仕方を案内する', async () => {
    render(<HarvestAlbumScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('まだ収穫がありません')).toBeTruthy(), {
      timeout: 20_000,
    });
  });

  it('月ごとに束ね、今年は年を省く', async () => {
    mockGetHarvestAlbum.mockResolvedValue([
      cell({ key: 'c1', harvestedAt: localIso(THIS_YEAR, 8, 10) }),
      cell({ key: 'c2', harvestedAt: localIso(THIS_YEAR - 1, 11, 3) }),
    ]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByText('8月')).toBeTruthy());
    // 去年の分は年を添えないと、8月と11月が同列に見える
    expect(screen.getByText(`${THIS_YEAR - 1}年11月`)).toBeTruthy();
  });

  it('総枚数を見出しに添える', async () => {
    mockGetHarvestAlbum.mockResolvedValue([cell({ key: 'c1' }), cell({ key: 'c2' })]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
  });

  // 写真だけを並べる実装に戻すと、数量だけの収穫がアルバムから消える
  it('写真の無い収穫もマスとして出す', async () => {
    mockGetHarvestAlbum.mockResolvedValue([
      cell({ key: 'c1', cropName: 'ナス', photoUri: null, quantity: 3, unit: 'piece' }),
    ]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByLabelText('ナスの収穫')).toBeTruthy());
    expect(screen.getByText('10日　3個')).toBeTruthy();
  });

  it('数量が無いマスは日付だけにする', async () => {
    mockGetHarvestAlbum.mockResolvedValue([cell({ key: 'c1', quantity: null, unit: null })]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByText('10日')).toBeTruthy());
  });

  it('マスから収穫の詳細へ飛ぶ', async () => {
    mockGetHarvestAlbum.mockResolvedValue([
      cell({ key: 'c1', plantingId: 'p9', harvestId: 'h9', cropName: 'キュウリ' }),
    ]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByLabelText('キュウリの収穫')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('キュウリの収穫'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h9');
  });
});

describe('収穫アルバム — 絞り込み', () => {
  it('作物が 1 種類だけならチップを出さない', async () => {
    mockGetHarvestCropNames.mockResolvedValue(['トマト']);
    mockGetHarvestAlbum.mockResolvedValue([cell({ key: 'c1' })]);
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(screen.getByLabelText('トマトの収穫')).toBeTruthy());
    expect(screen.queryByText('すべて')).toBeNull();
  });

  it('チップで作物を絞り、もう一度押すと解除する', async () => {
    mockGetHarvestCropNames.mockResolvedValue(['トマト', 'ナス']);
    mockGetHarvestAlbum.mockResolvedValue([cell({ key: 'c1' })]);
    render(<HarvestAlbumScreen />);
    await waitFor(() => expect(screen.getByText('ナス')).toBeTruthy());

    fireEvent.press(screen.getByText('ナス'));
    await waitFor(() =>
      expect(mockGetHarvestAlbum.mock.calls.some((call) => call[0]?.cropName === 'ナス')).toBe(
        true,
      ),
    );

    // 同じチップは絞り込みの解除。別の解除ボタンを探させない
    fireEvent.press(screen.getByText('ナス'));
    await waitFor(() =>
      expect(mockGetHarvestAlbum.mock.calls.some((call) => call[0]?.cropName === undefined)).toBe(
        true,
      ),
    );
  });

  it('絞り込んで 0 件なら、絞り込み中だと分かる空状態にして解除させる', async () => {
    mockGetHarvestCropNames.mockResolvedValue(['トマト', 'ナス']);
    mockGetHarvestAlbum.mockResolvedValue([]);
    render(<HarvestAlbumScreen />);
    await waitFor(() => expect(screen.getByText('ナス')).toBeTruthy());

    fireEvent.press(screen.getByText('ナス'));

    await waitFor(() => expect(screen.getByText('ナスの収穫はまだありません')).toBeTruthy());
    fireEvent.press(screen.getByText('すべて表示'));

    await waitFor(() => expect(screen.getByText('まだ収穫がありません')).toBeTruthy());
  });

  // 栽培詳細の「収穫 ›」から来た場合。渡し損ねると全栽培の収穫が出る
  it('plantingId つきで開かれたらサービスへ渡す', async () => {
    mockParams = { plantingId: 'p7' };
    render(<HarvestAlbumScreen />);

    await waitFor(() => expect(mockGetHarvestAlbum).toHaveBeenCalled());
    expect(mockGetHarvestAlbum.mock.calls[0][0]).toMatchObject({ plantingId: 'p7' });
  });
});

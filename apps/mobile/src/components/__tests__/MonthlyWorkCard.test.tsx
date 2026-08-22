/**
 * 「今月の菜園仕事」カードのテスト（R08 / WBS 3.2）。
 * 暦の中身は garden-work.service のテストで担保。ここは**出し分け**を見る:
 * 空の欄は行ごと消えるか・全部空ならカードごと消えるか・地域の変更導線。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { MonthlyGardenWork } from '../../services/garden-work.service';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetWork = jest.fn();
jest.mock('../../services/garden-work.service', () => ({
  getMonthlyGardenWork: (...args: unknown[]) => mockGetWork(...args),
}));

import { MonthlyWorkCard } from '../MonthlyWorkCard';

function work(overrides: Partial<MonthlyGardenWork> = {}): MonthlyGardenWork {
  return {
    month: 8,
    region: 'temperate',
    sow: [],
    plant: [],
    harvest: [],
    ...overrides,
  };
}

describe('MonthlyWorkCard', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetWork.mockReset().mockResolvedValue(work());
  });

  it('月・地域・作物を出す', async () => {
    mockGetWork.mockResolvedValue(
      work({
        sow: [{ cropId: 'crop-daikon', name: 'ダイコン' }],
        plant: [{ cropId: 'crop-hakusai', name: 'ハクサイ' }],
        harvest: [{ cropId: 'crop-tomato', name: 'トマト' }],
      }),
    );
    render(<MonthlyWorkCard />);

    await waitFor(() => expect(screen.getByText('8月の菜園仕事')).toBeTruthy());
    expect(screen.getByText('中間地')).toBeTruthy();
    expect(screen.getByText('まきどき')).toBeTruthy();
    expect(screen.getByText('ダイコン')).toBeTruthy();
    expect(screen.getByText('植えどき')).toBeTruthy();
    expect(screen.getByText('ハクサイ')).toBeTruthy();
    expect(screen.getByText('採りどき')).toBeTruthy();
    expect(screen.getByText('トマト')).toBeTruthy();
  });

  it('空の欄は行ごと出さない', async () => {
    mockGetWork.mockResolvedValue(work({ harvest: [{ cropId: 'crop-tomato', name: 'トマト' }] }));
    render(<MonthlyWorkCard />);

    await waitFor(() => expect(screen.getByText('採りどき')).toBeTruthy());
    expect(screen.queryByText('まきどき')).toBeNull();
    expect(screen.queryByText('植えどき')).toBeNull();
  });

  it('全部空ならカードごと出さない', async () => {
    render(<MonthlyWorkCard />);

    await waitFor(() => expect(mockGetWork).toHaveBeenCalled());
    expect(screen.queryByText(/月の菜園仕事/)).toBeNull();
  });

  it('複数の作物は読点でつなぐ', async () => {
    mockGetWork.mockResolvedValue(
      work({
        sow: [
          { cropId: 'crop-daikon', name: 'ダイコン' },
          { cropId: 'crop-kabu', name: 'カブ' },
        ],
      }),
    );
    render(<MonthlyWorkCard />);

    await waitFor(() => expect(screen.getByText('ダイコン、カブ')).toBeTruthy());
  });

  it('出典を小さく明記する（判断②: 公的資料ベースの目安であること）', async () => {
    mockGetWork.mockResolvedValue(work({ sow: [{ cropId: 'crop-daikon', name: 'ダイコン' }] }));
    render(<MonthlyWorkCard />);

    await waitFor(() =>
      expect(
        screen.getByText('農林水産省・JAグループ等の公開資料をもとにした目安です'),
      ).toBeTruthy(),
    );
  });

  it('地域ラベルから設定へ飛べる', async () => {
    mockGetWork.mockResolvedValue(
      work({ region: 'warm', sow: [{ cropId: 'crop-daikon', name: 'ダイコン' }] }),
    );
    render(<MonthlyWorkCard />);
    await waitFor(() => expect(screen.getByText('暖地')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('地域を変更'));

    expect(mockPush).toHaveBeenCalledWith('/region');
  });

  it('読み込みに失敗したら黙って出さない（ホームを壊さない）', async () => {
    mockGetWork.mockRejectedValue(new Error('boom'));
    render(<MonthlyWorkCard />);

    await waitFor(() => expect(mockGetWork).toHaveBeenCalled());
    expect(screen.queryByText(/月の菜園仕事/)).toBeNull();
  });
});

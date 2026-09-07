/**
 * 「去年の今ごろ」カード（R27 / WBS 4.9）。
 *
 * 何を出すかの判断はサービスのテストが担保するので、ここで見るのは
 * **3 つの state をどう描き分けるか**と**タップの遷移先**だけ。
 * とくに `none` で**何も描かない**ことは、ホームが縦に伸びないための
 * 生命線なので固定する。
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetLastYearCard = jest.fn();
jest.mock('../../services/last-year.service', () => ({
  ...jest.requireActual('../../services/last-year.service'),
  getLastYearCard: (...args: unknown[]) => mockGetLastYearCard(...args),
}));

import { LastYearCard } from '../LastYearCard';

beforeEach(() => {
  jest.clearAllMocks();
});

function highlight(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'h1',
    plantingId: 'p1',
    type: 'harvest',
    kind: null,
    cropName: 'キュウリ',
    date: '2025-09-07',
    ...overrides,
  };
}

describe('LastYearCard', () => {
  it('去年の記録が無ければ何も描かない（ホームを伸ばさない）', async () => {
    mockGetLastYearCard.mockResolvedValue({ state: 'none' });
    render(<LastYearCard />);
    // 読み込みの解決を act の中で流す（描かないことの確認なので findBy が使えない）
    await act(async () => {});
    expect(screen.toJSON()).toBeNull();
  });

  it('サービスが落ちてもホームは開ける（カードを出さないだけ）', async () => {
    mockGetLastYearCard.mockRejectedValue(new Error('DB が読めない'));
    render(<LastYearCard />);
    // 読み込みの解決を act の中で流す（描かないことの確認なので findBy が使えない）
    await act(async () => {});
    expect(screen.toJSON()).toBeNull();
  });

  describe('去年の記録があるとき', () => {
    it('去年の出来事を言葉にして出す', async () => {
      mockGetLastYearCard.mockResolvedValue({
        state: 'last_year',
        highlight: highlight(),
        photos: [],
        entryCount: 1,
      });
      render(<LastYearCard />);

      expect(await screen.findByText('去年の今ごろ')).toBeTruthy();
      expect(screen.getByText('去年の9月7日、キュウリを収穫していました')).toBeTruthy();
    });

    it('見出しをタップすると去年の記録を開く', async () => {
      mockGetLastYearCard.mockResolvedValue({
        state: 'last_year',
        highlight: highlight({ entryId: 'h9', plantingId: 'p9' }),
        photos: [],
        entryCount: 1,
      });
      render(<LastYearCard />);

      fireEvent.press(await screen.findByTestId('last-year-highlight'));
      expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h9');
    });

    it('写真をタップすると、その写真の記録へ行く（見出しの記録とは限らない）', async () => {
      mockGetLastYearCard.mockResolvedValue({
        state: 'last_year',
        highlight: highlight(),
        photos: [{ uri: 'file:///a.jpg', entryId: 'c5', plantingId: 'p2', type: 'care_log' }],
        entryCount: 2,
      });
      render(<LastYearCard />);

      fireEvent.press(await screen.findByLabelText('去年の写真を開く'));
      expect(mockPush).toHaveBeenCalledWith('/plantings/p2/care-logs/c5');
    });

    it('ほかにも記録があれば件数を添える', async () => {
      mockGetLastYearCard.mockResolvedValue({
        state: 'last_year',
        highlight: highlight(),
        photos: [],
        entryCount: 5,
      });
      render(<LastYearCard />);

      expect(await screen.findByText('この時期の記録は ほか4件')).toBeTruthy();
    });

    it('1 件だけなら件数は添えない', async () => {
      mockGetLastYearCard.mockResolvedValue({
        state: 'last_year',
        highlight: highlight(),
        photos: [],
        entryCount: 1,
      });
      render(<LastYearCard />);

      await screen.findByText('去年の今ごろ');
      expect(screen.queryByText(/ほか/)).toBeNull();
    });
  });

  // R27 の空状態。「まだ記録がありません」ではなく、
  // 今年ぶんが来年効くことを返す
  describe('初年度（来年の今ごろ）', () => {
    it('今年の件数を添えて「来年ここに並びます」と伝える', async () => {
      mockGetLastYearCard.mockResolvedValue({ state: 'this_year', entryCount: 7 });
      render(<LastYearCard />);

      expect(await screen.findByText('来年の今ごろ')).toBeTruthy();
      expect(screen.getByText('7件')).toBeTruthy();
      expect(screen.getByText(/来年の今ごろ、ここに並びます/)).toBeTruthy();
    });

    it('去年の見出しは出さない', async () => {
      mockGetLastYearCard.mockResolvedValue({ state: 'this_year', entryCount: 7 });
      render(<LastYearCard />);

      await screen.findByText('来年の今ごろ');
      expect(screen.queryByText('去年の今ごろ')).toBeNull();
      expect(screen.queryByTestId('last-year-highlight')).toBeNull();
    });
  });
});

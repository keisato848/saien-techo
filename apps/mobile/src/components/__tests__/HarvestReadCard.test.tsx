/**
 * 「写真の読み取り」カード（#143）。
 * 0 件なら**何も描かない**（余白すら出さない）ことと、タップで読み取り画面へ
 * 行くことだけを固定する。件数の中身はサービスのテストが担保。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetOpenReadCount = jest.fn();
jest.mock('../../services/harvest-read.service', () => ({
  getOpenReadCount: (...args: unknown[]) => mockGetOpenReadCount(...args),
}));

import { HarvestReadCard } from '../HarvestReadCard';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HarvestReadCard', () => {
  it('0 件なら何も描かない', async () => {
    mockGetOpenReadCount.mockResolvedValue(0);
    render(<HarvestReadCard />);
    await Promise.resolve();
    expect(screen.toJSON()).toBeNull();
  });

  it('待ちがあれば枚数を出し、タップで読み取り画面へ', async () => {
    mockGetOpenReadCount.mockResolvedValue(3);
    render(<HarvestReadCard />);

    const card = await screen.findByTestId('harvest-read-card');
    expect(screen.getByText(/3 枚/)).toBeTruthy();
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/harvests/reads');
  });
});

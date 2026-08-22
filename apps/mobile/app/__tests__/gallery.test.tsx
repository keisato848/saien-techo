/**
 * ギャラリーの画面テスト（R05 / WBS 2.3）。
 *
 * この画面は**写真 1 枚が 1 マス**。記録 1 件を 1 マスにすると、
 * 1 回の記録で 3 枚撮った写真のうち 1 枚しか見えない。
 * 作業ログと収穫が混ざるので、マスから戻る先も種別で分かれる。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { GardenTimelineEntry } from '../../src/services/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRouter = { push: mockPush, back: mockBack };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetTimeline = jest.fn();
jest.mock('../../src/services/garden-timeline.service', () => ({
  getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
}));

import GalleryScreen from '../gallery';

function entry(overrides: Partial<GardenTimelineEntry> & { id: string }): GardenTimelineEntry {
  return {
    type: 'care_log',
    plantingId: 'p1',
    cropName: 'トマト',
    variety: null,
    kind: 'water',
    quantity: null,
    unit: null,
    loggedAt: '2026-06-01T00:00:00.000Z',
    note: null,
    photoUris: ['file:///a.jpg'],
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockGetTimeline.mockReset().mockResolvedValue([]);
});

describe('ギャラリー', () => {
  it('写真が無ければ、付け方を案内する', async () => {
    render(<GalleryScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('まだ写真がありません')).toBeTruthy(), {
      timeout: 20_000,
    });
  });

  // 記録 1 件を 1 マスにすると、まとめて撮った写真が 1 枚しか見えない
  it('1 件の記録に複数枚あれば、枚数ぶんのマスにする', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'c1', photoUris: ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'] }),
    ]);
    render(<GalleryScreen />);

    await waitFor(() => expect(screen.getAllByLabelText('トマトの写真')).toHaveLength(3));
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('新しい記録の写真から並べる', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'c1', cropName: '古い', loggedAt: '2026-05-01T00:00:00.000Z' }),
      entry({ id: 'c2', cropName: '新しい', loggedAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    render(<GalleryScreen />);

    await waitFor(() => expect(screen.getAllByLabelText(/の写真$/)).toHaveLength(2));
    const labels = screen
      .getAllByLabelText(/の写真$/)
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels).toEqual(['新しいの写真', '古いの写真']);
  });

  it('作業ログの写真は作業ログへ戻る', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c9', plantingId: 'p9' })]);
    render(<GalleryScreen />);

    await waitFor(() => expect(screen.getByLabelText('トマトの写真')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('トマトの写真'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/care-logs/c9');
  });

  // 収穫は保存先が別。作業ログの経路へ送ると「見つかりません」になる
  it('収穫の写真は収穫へ戻る', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'h9', type: 'harvest', kind: null, plantingId: 'p9' }),
    ]);
    render(<GalleryScreen />);

    await waitFor(() => expect(screen.getByLabelText('トマトの写真')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('トマトの写真'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h9');
  });

  // カレンダーと違い、ここは全期間。期間を渡すと過去の写真が消える
  it('期間を絞らずに引く', async () => {
    render(<GalleryScreen />);

    await waitFor(() => expect(mockGetTimeline).toHaveBeenCalled());
    expect(mockGetTimeline.mock.calls[0][0]).toBeUndefined();
  });

  it('閉じるで戻る', async () => {
    render(<GalleryScreen />);
    await waitFor(() => expect(screen.getByLabelText('閉じる')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('閉じる'));
    expect(mockBack).toHaveBeenCalled();
  });
});

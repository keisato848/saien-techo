/**
 * 「つぎの作業」カードのテスト（R10 / WBS 3.4）。
 * 判定は next-action.service のテストで担保。ここは**遷移と先送り**を見る。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { NextAction } from '../../services/next-action.service';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetActions = jest.fn();
const mockSnooze = jest.fn();
jest.mock('../../services/next-action.service', () => ({
  ...jest.requireActual('../../services/next-action.service'),
  getNextActions: (...args: unknown[]) => mockGetActions(...args),
  snoozeNextAction: (...args: unknown[]) => mockSnooze(...args),
}));

import { NextActionCard } from '../NextActionCard';

function action(overrides: Partial<NextAction> = {}): NextAction {
  return {
    plantingId: 'p1',
    cropName: 'カブ',
    kind: 'fertilize',
    elapsedDays: 21,
    thresholdDays: 20,
    ...overrides,
  };
}

describe('NextActionCard', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetActions.mockReset().mockResolvedValue([]);
    mockSnooze.mockReset().mockResolvedValue(undefined);
  });

  it('提案が無ければカードごと出さない', async () => {
    render(<NextActionCard />);

    await waitFor(() => expect(mockGetActions).toHaveBeenCalled());
    expect(screen.queryByText('つぎの作業')).toBeNull();
  });

  it('作物名と提案文を出す', async () => {
    mockGetActions.mockResolvedValue([action()]);
    render(<NextActionCard />);

    await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());
    expect(screen.getByText('カブ')).toBeTruthy();
    expect(screen.getByText('そろそろ追肥（植え付けから21日・目安 約20日）')).toBeTruthy();
  });

  it('追肥の「記録する」は kind 付きで作業記録へ', async () => {
    mockGetActions.mockResolvedValue([action()]);
    render(<NextActionCard />);
    await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('カブの追肥を記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=fertilize');
  });

  it('収穫の「記録する」は収穫記録へ', async () => {
    mockGetActions.mockResolvedValue([
      action({ kind: 'harvest', elapsedDays: 50, thresholdDays: 45 }),
    ]);
    render(<NextActionCard />);
    await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('カブの収穫を記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/new');
  });

  it('作業（芽かき）は剪定の作業ログへ、土寄せはその他へ送る（4.19）', async () => {
    mockGetActions.mockResolvedValue([
      action({ kind: 'sucker', thresholdDays: 10, elapsedDays: 12, cropName: 'トマト' }),
      action({ kind: 'hill', thresholdDays: 35, elapsedDays: 36, cropName: 'ジャガイモ' }),
    ]);
    render(<NextActionCard />);
    await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('トマトの芽かきを記録する'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=prune');

    fireEvent.press(screen.getByLabelText('ジャガイモの土寄せを記録する'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=other');
  });

  it('「あとで」で先送りして読み直す', async () => {
    mockGetActions.mockResolvedValue([action()]);
    render(<NextActionCard />);
    await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

    mockGetActions.mockResolvedValue([]);
    fireEvent.press(screen.getByLabelText('カブの提案をあとで'));

    await waitFor(() => expect(mockSnooze).toHaveBeenCalledWith('p1', 'fertilize', 20));
    await waitFor(() => expect(screen.queryByText('つぎの作業')).toBeNull());
  });

  it('読み込みに失敗したら黙って出さない（ホームを壊さない）', async () => {
    mockGetActions.mockRejectedValue(new Error('boom'));
    render(<NextActionCard />);

    await waitFor(() => expect(mockGetActions).toHaveBeenCalled());
    expect(screen.queryByText('つぎの作業')).toBeNull();
  });

  // 「つぎの作業」は栽培ごとに行が増え、ホームで「育てているもの」（進行帯）を
  // 画面外に押し出す。上位 2 件で打ち切り、残りは「ほかN件」に畳む（2026-09-01）
  describe('3件以上の打ち切り', () => {
    function actions3() {
      return [
        action({ plantingId: 'p1', cropName: 'カブ' }),
        action({ plantingId: 'p2', cropName: 'ダイコン' }),
        action({ plantingId: 'p3', cropName: 'ホウレンソウ' }),
      ];
    }

    it('上位2件だけカードで出し、3件目以降は「ほかN件」にまとめる', async () => {
      mockGetActions.mockResolvedValue(actions3());
      render(<NextActionCard />);

      await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

      expect(screen.getByText('カブ')).toBeTruthy();
      expect(screen.getByText('ダイコン')).toBeTruthy();
      expect(screen.queryByText('ホウレンソウ')).toBeNull();
      expect(screen.getByText('ほか1件 →')).toBeTruthy();
    });

    it('並び順（優先度）はそのまま。上位2件は getNextActions の返り順どおり', async () => {
      mockGetActions.mockResolvedValue(actions3());
      render(<NextActionCard />);
      await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

      // 3件目（ホウレンソウ）の「記録する」ボタンは存在しない = slice(0, 2) だけを描画
      expect(screen.queryByLabelText('ホウレンソウの追肥を記録する')).toBeNull();
    });

    it('「ほかN件」をタップすると栽培一覧へ遷移する', async () => {
      mockGetActions.mockResolvedValue(actions3());
      render(<NextActionCard />);
      await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

      fireEvent.press(screen.getByLabelText('ほかの提案1件を栽培一覧で見る'));

      expect(mockPush).toHaveBeenCalledWith('/plantings');
    });

    it('2件以下では「ほか」の行を出さない', async () => {
      mockGetActions.mockResolvedValue([
        action({ plantingId: 'p1', cropName: 'カブ' }),
        action({ plantingId: 'p2', cropName: 'ダイコン' }),
      ]);
      render(<NextActionCard />);
      await waitFor(() => expect(screen.getByText('つぎの作業')).toBeTruthy());

      expect(screen.queryByText(/^ほか/)).toBeNull();
    });
  });
});

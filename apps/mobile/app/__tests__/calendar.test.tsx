/**
 * カレンダーの画面テスト（R05 / WBS 2.3）。
 *
 * 見るのは 3 つ。**表示中の月だけを引くこと**（全期間を引くと記録が増えたとき開くのが遅い）、
 * **記録のある日だけを押せること**、**選んだ日から正しい記録へ飛ぶこと**。
 * 月をまたいだときに選択が残ると、前の月の日付の記録が今の月に出たように見える。
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

import CalendarScreen from '../calendar';

const TODAY = new Date();
const YEAR = TODAY.getFullYear();
const MONTH = TODAY.getMonth(); // 0 始まり
/** どの月にも必ずある日。今日と重なっても表示は変わらない */
const DAY = 15;

function entry(overrides: Partial<GardenTimelineEntry> & { id: string }): GardenTimelineEntry {
  return {
    type: 'care_log',
    plantingId: 'p1',
    cropName: 'トマト',
    variety: null,
    kind: 'water',
    quantity: null,
    unit: null,
    // 端末のタイムゾーンで束ねる実装に合わせ、ローカル時刻で作る
    loggedAt: new Date(YEAR, MONTH, DAY, 9, 0, 0).toISOString(),
    note: null,
    photoUris: [],
    ...overrides,
  };
}

function monthLabel(year: number, month0: number): string {
  const date = new Date(year, month0, 1);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockGetTimeline.mockReset().mockResolvedValue([]);
});

describe('カレンダー — 月の移動', () => {
  it('今月から開き、表示中の月だけを引く', async () => {
    render(<CalendarScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText(monthLabel(YEAR, MONTH))).toBeTruthy(), {
      timeout: 20_000,
    });

    const range = mockGetTimeline.mock.calls[0][0] as { from: string; to: string };
    expect(range.from).toBe(new Date(YEAR, MONTH, 1).toISOString());
    expect(range.to).toBe(new Date(YEAR, MONTH + 1, 0, 23, 59, 59, 999).toISOString());
  });

  it('前後の月へ動かすと、その月で引き直す', async () => {
    render(<CalendarScreen />);
    await waitFor(() => expect(mockGetTimeline).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('次の月'));
    await waitFor(() => expect(screen.getByText(monthLabel(YEAR, MONTH + 1))).toBeTruthy());
    await waitFor(() =>
      expect(
        mockGetTimeline.mock.calls.some(
          (call) => call[0]?.from === new Date(YEAR, MONTH + 1, 1).toISOString(),
        ),
      ).toBe(true),
    );

    fireEvent.press(screen.getByLabelText('前の月'));
    fireEvent.press(screen.getByLabelText('前の月'));
    await waitFor(() => expect(screen.getByText(monthLabel(YEAR, MONTH - 1))).toBeTruthy());
  });

  // 選択が残ると、前の月の日付の記録が今の月に出たように見える
  it('月をまたぐと選んだ日を解除する', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c1', note: '朝の水やり' })]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));
    await waitFor(() => expect(screen.getByText('朝の水やり')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('次の月'));

    await waitFor(() => expect(screen.queryByText('朝の水やり')).toBeNull());
  });

  it('閉じるで戻る', async () => {
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText('閉じる')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('閉じる'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('カレンダー — 日の選択', () => {
  it('記録の無い月はその旨を出す', async () => {
    render(<CalendarScreen />);

    await waitFor(() => expect(screen.getByText('この月の記録はありません。')).toBeTruthy());
  });

  it('記録があって未選択なら、選ばせる案内に変える', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c1' })]);
    render(<CalendarScreen />);

    await waitFor(() =>
      expect(screen.getByText('日付を選ぶと、その日の記録が出ます。')).toBeTruthy(),
    );
  });

  it('記録の無い日は押せない', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c1' })]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    // 記録がある日は件数つきのラベルになる。素の「N日」は記録の無い日
    fireEvent.press(screen.getByLabelText(`${DAY + 1}日`));

    expect(screen.getByText('日付を選ぶと、その日の記録が出ます。')).toBeTruthy();
  });

  it('選んだ日をもう一度押すと閉じる', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c1', note: '朝の水やり' })]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));
    await waitFor(() => expect(screen.getByText('朝の水やり')).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));
    expect(screen.queryByText('朝の水やり')).toBeNull();
  });

  it('同じ日の作業と収穫をまとめて出す', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'c1', kind: 'prune', note: 'わき芽かき' }),
      entry({ id: 'h1', type: 'harvest', kind: null, quantity: 3, unit: 'piece' }),
    ]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 2 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 2 件`));

    await waitFor(() => expect(screen.getByText('わき芽かき')).toBeTruthy());
    expect(screen.getByText(/収穫 3個/)).toBeTruthy();
  });

  it('数量の無い収穫は「収穫」とだけ出す', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'h1', type: 'harvest', kind: null, quantity: null, unit: null }),
    ]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));

    // 凡例にも「収穫」があるので、作物名と続けて引く
    await waitFor(() => expect(screen.getByText('トマト　収穫')).toBeTruthy());
  });
});

describe('カレンダー — 記録へ飛ぶ', () => {
  it('作業ログは作業ログの編集へ送る', async () => {
    mockGetTimeline.mockResolvedValue([entry({ id: 'c9', plantingId: 'p9', note: '朝の水やり' })]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));
    await waitFor(() => expect(screen.getByText('朝の水やり')).toBeTruthy());
    fireEvent.press(screen.getByText('朝の水やり'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/care-logs/c9');
  });

  // 収穫は保存先が別。作業ログの経路へ送ると「見つかりません」になる
  it('収穫は収穫の詳細へ送る', async () => {
    mockGetTimeline.mockResolvedValue([
      entry({ id: 'h9', type: 'harvest', kind: null, plantingId: 'p9', note: '初なり' }),
    ]);
    render(<CalendarScreen />);
    await waitFor(() => expect(screen.getByLabelText(`${DAY}日　記録 1 件`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${DAY}日　記録 1 件`));
    await waitFor(() => expect(screen.getByText('初なり')).toBeTruthy());
    fireEvent.press(screen.getByText('初なり'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h9');
  });
});

/**
 * 「今日のリマインダー」カードのテスト（R11 / WBS 3.5）。
 * 予定を今日に出すかどうかの判定は reminder.service / reminderSchedule の
 * テストで担保。ここは**出し分けと遷移**を見る。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { TodayReminder } from '../../services/reminder.service';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetTodayReminders = jest.fn();
jest.mock('../../services/reminder.service', () => ({
  ...jest.requireActual('../../services/reminder.service'),
  getTodayReminders: (...args: unknown[]) => mockGetTodayReminders(...args),
}));

import { formatReminderTime, TodayReminderCard } from '../TodayReminderCard';

function reminder(overrides: Partial<TodayReminder> = {}): TodayReminder {
  return {
    id: 'r1',
    plantingId: 'p1',
    cropName: 'トマト',
    kind: 'water',
    at: new Date(2026, 7, 10, 7, 0),
    done: false,
    ...overrides,
  };
}

describe('formatReminderTime', () => {
  it('分は 2 桁に揃える（行ごとに幅が揺れない）', () => {
    expect(formatReminderTime(new Date(2026, 7, 10, 7, 5))).toBe('7:05');
    expect(formatReminderTime(new Date(2026, 7, 10, 18, 30))).toBe('18:30');
  });
});

describe('TodayReminderCard', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetTodayReminders.mockReset().mockResolvedValue([]);
  });

  it('予定が無ければカードごと出さない', async () => {
    render(<TodayReminderCard />);

    await waitFor(() => expect(mockGetTodayReminders).toHaveBeenCalled());
    expect(screen.queryByText('今日のリマインダー')).toBeNull();
  });

  it('時刻・作物・作業を出す', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder()]);
    render(<TodayReminderCard />);

    await waitFor(() => expect(screen.getByText('今日のリマインダー')).toBeTruthy());
    expect(screen.getByText('7:00')).toBeTruthy();
    expect(screen.getByText('トマト')).toBeTruthy();
    expect(screen.getByText(/水やり/)).toBeTruthy();
  });

  it('記録済みには印を付ける（やったか分かるように）', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ done: true })]);
    render(<TodayReminderCard />);

    await waitFor(() => expect(screen.getByText('記録済み')).toBeTruthy());
  });

  it('未記録には印を付けない', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ done: false })]);
    render(<TodayReminderCard />);

    await waitFor(() => expect(screen.getByText('今日のリマインダー')).toBeTruthy());
    expect(screen.queryByText('記録済み')).toBeNull();
  });

  it('行をタップすると種別を選択済みの作業記録へ', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ kind: 'fertilize' })]);
    render(<TodayReminderCard />);
    await waitFor(() => expect(screen.getByText('今日のリマインダー')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('トマトの追肥を記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=fertilize');
  });

  it('記録済みでも開ける（追加で記録したいことがある）', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ done: true })]);
    render(<TodayReminderCard />);
    await waitFor(() => expect(screen.getByText('記録済み')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('トマトの水やりを記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=water');
  });

  it('読み込みに失敗したら黙って出さない（ホームを壊さない）', async () => {
    mockGetTodayReminders.mockRejectedValue(new Error('boom'));
    render(<TodayReminderCard />);

    await waitFor(() => expect(mockGetTodayReminders).toHaveBeenCalled());
    expect(screen.queryByText('今日のリマインダー')).toBeNull();
  });
});

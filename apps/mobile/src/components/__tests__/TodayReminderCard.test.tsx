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

const mockCreateCareLog = jest.fn();
jest.mock('../../services/care-log.service', () => ({
  ...jest.requireActual('../../services/care-log.service'),
  createCareLog: (...args: unknown[]) => mockCreateCareLog(...args),
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
    mockCreateCareLog.mockReset().mockResolvedValue('log-1');
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

  it('未記録には「記録」ボタンを出す（押せることが見た目で分かるように）', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder()]);
    render(<TodayReminderCard />);

    await waitFor(() => expect(screen.getByText('記録')).toBeTruthy());
  });

  it('「記録」ボタンは 1 タップで記録する（フォームを開かない）', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ kind: 'fertilize' })]);
    render(<TodayReminderCard />);
    await waitFor(() => expect(screen.getByText('記録')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('トマトの追肥を今すぐ記録'));

    await waitFor(() =>
      expect(mockCreateCareLog).toHaveBeenCalledWith({ plantingId: 'p1', kind: 'fertilize' }),
    );
    // ボタンは form へ飛ばさない（行の他の場所が担当）
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('記録済みならボタンを出さない（二重記録の入口を作らない）', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder({ done: true })]);
    render(<TodayReminderCard />);

    await waitFor(() => expect(screen.getByText('記録済み')).toBeTruthy());
    expect(screen.queryByText('記録')).toBeNull();
  });

  it('二度押しても 2 件記録しない', async () => {
    mockGetTodayReminders.mockResolvedValue([reminder()]);
    let resolveCreate: (value: string) => void = () => {};
    mockCreateCareLog.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(<TodayReminderCard />);
    await waitFor(() => expect(screen.getByText('記録')).toBeTruthy());

    const button = screen.getByLabelText('トマトの水やりを今すぐ記録');
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockCreateCareLog).toHaveBeenCalledTimes(1);
    resolveCreate('log-1');
  });

  it('読み込みに失敗したら黙って出さない（ホームを壊さない）', async () => {
    mockGetTodayReminders.mockRejectedValue(new Error('boom'));
    render(<TodayReminderCard />);

    await waitFor(() => expect(mockGetTodayReminders).toHaveBeenCalled());
    expect(screen.queryByText('今日のリマインダー')).toBeNull();
  });
});

/**
 * リマインダーの追加・編集画面（R11 / WBS 2.5）。
 *
 * 作業ログの 2 画面と同じ原因の持ち越しがここにもある（ReminderForm も
 * useState で初期値を受ける）。見るのは**開き直したときに前回の値が残らないこと**。
 *
 * - 編集: お知らせ A を開く → 戻る → お知らせ B を開くと A の設定が出て、
 *   保存すると B が A の内容で上書きされる
 * - 追加: 別の栽培でお知らせを追加しようとすると、前の栽培で選んだ設定が残る
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
// 実物の useRouter は同じオブジェクトを返す
const mockRouter = { back: mockBack };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockCreateReminder = jest.fn(() => Promise.resolve('new-id'));
const mockUpdateReminder = jest.fn(() => Promise.resolve());
const mockGetReminder = jest.fn();
jest.mock('../../../../src/services/reminder.service', () => ({
  ...jest.requireActual('../../../../src/services/reminder.service'),
  createReminder: (...args: unknown[]) => mockCreateReminder(...args),
  updateReminder: (...args: unknown[]) => mockUpdateReminder(...args),
  getReminder: (...args: unknown[]) => mockGetReminder(...args),
}));

import NewReminderScreen from '../[id]/reminders/new';
import EditReminderScreen from '../[id]/reminders/[reminderId]';

function reminder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    plantingId: 'p1',
    kind: 'water',
    scheduleKind: 'daily',
    intervalDays: null,
    weekdays: [],
    hour: 7,
    minute: 0,
    enabled: true,
    lastFiredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockBack.mockReset();
  mockCreateReminder.mockReset().mockResolvedValue('new-id');
  mockUpdateReminder.mockReset().mockResolvedValue(undefined);
  mockGetReminder.mockReset();
});

describe('お知らせを編集', () => {
  it('開いたお知らせの設定が入っている', async () => {
    mockParams = { id: 'p1', reminderId: 'r1' };
    mockGetReminder.mockResolvedValue(reminder({ kind: 'fertilize', hour: 15 }));
    render(<EditReminderScreen />);

    await waitFor(() => expect(screen.getByText('お知らせを編集')).toBeTruthy());

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() =>
      expect(mockUpdateReminder).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ kind: 'fertilize', hour: 15 }),
      ),
    );
  });

  // 前のお知らせの設定のまま保存すると、別のお知らせを上書きしてしまう
  it('続けて別のお知らせを開くと、その設定に入れ替わる', async () => {
    mockParams = { id: 'p1', reminderId: 'r1' };
    mockGetReminder.mockResolvedValue(reminder({ kind: 'fertilize', hour: 15 }));
    const view = render(<EditReminderScreen />);
    await waitFor(() => expect(screen.getByText('お知らせを編集')).toBeTruthy());

    mockParams = { id: 'p1', reminderId: 'r2' };
    mockGetReminder.mockResolvedValue(reminder({ id: 'r2', kind: 'prune', hour: 6 }));
    view.rerender(<EditReminderScreen />);

    await waitFor(() => expect(screen.getByText('お知らせを編集')).toBeTruthy());
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdateReminder).toHaveBeenCalledWith(
        'r2',
        expect.objectContaining({ kind: 'prune', hour: 6 }),
      ),
    );
  });
});

describe('お知らせを追加', () => {
  it('既定は水やり・毎日・7:00', async () => {
    mockParams = { id: 'p1' };
    render(<NewReminderScreen />);

    fireEvent.press(screen.getByText('追加'));

    await waitFor(() =>
      expect(mockCreateReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          plantingId: 'p1',
          kind: 'water',
          scheduleKind: 'daily',
          hour: 7,
        }),
      ),
    );
  });

  // 別の栽培のフォームに、前の栽培で選んだ設定を持ち越さない
  it('栽培をまたぐと既定に戻る', async () => {
    mockParams = { id: 'p1' };
    const view = render(<NewReminderScreen />);

    // 1 つ目の栽培で既定から変える
    fireEvent.press(screen.getByText('追肥'));
    fireEvent.press(screen.getByText('15時'));

    // 別の栽培のフォームを開く
    mockParams = { id: 'p2' };
    view.rerender(<NewReminderScreen />);

    fireEvent.press(screen.getByText('追加'));

    await waitFor(() =>
      expect(mockCreateReminder).toHaveBeenCalledWith(
        expect.objectContaining({ plantingId: 'p2', kind: 'water', hour: 7 }),
      ),
    );
  });
});

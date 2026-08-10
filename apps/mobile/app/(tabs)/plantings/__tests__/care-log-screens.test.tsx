/**
 * 作業ログの記録・編集画面（R04 / WBS 1.8）。
 *
 * 見るのは**画面を続けて開き直したときに前回の値が残らないこと**。
 * この 2 画面は 2 回目以降の遷移で再マウントされず、CareLogForm の useState が
 * 前回の値を持ち越す。実機で次の 2 つを踏んだ:
 *
 * - 記録: 水やりの行を開く → 戻る → 剪定の行を開くと**水やりのまま**開く
 * - 編集: 水やりの記録を開く → 戻る → 剪定の記録を開くと**水やりの内容**が出て、
 *   保存すると別の記録の内容で上書きされる
 *
 * どちらも警告が出ないので、利用者は違う作業を記録したことに気づけない。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockBack = jest.fn();
// 実物の useRouter は同じオブジェクトを返す。毎回新しく作ると
// 依存配列に入れている画面が再読み込みを繰り返し、実機と挙動がずれる
const mockRouter = { back: mockBack };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockCreateCareLog = jest.fn(() => Promise.resolve('new-id'));
const mockUpdateCareLog = jest.fn(() => Promise.resolve());
const mockGetCareLog = jest.fn();
jest.mock('../../../../src/services/care-log.service', () => ({
  ...jest.requireActual('../../../../src/services/care-log.service'),
  createCareLog: (...args: unknown[]) => mockCreateCareLog(...args),
  updateCareLog: (...args: unknown[]) => mockUpdateCareLog(...args),
  getCareLog: (...args: unknown[]) => mockGetCareLog(...args),
}));

jest.mock('../../../../src/services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(),
}));
jest.mock('../../../../src/services/photo-capture.service', () => ({
  capturePhoto: jest.fn(),
}));
jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

import NewCareLogScreen from '../[id]/care-logs/new';
import EditCareLogScreen from '../[id]/care-logs/[logId]';

beforeEach(() => {
  mockBack.mockReset();
  mockCreateCareLog.mockReset().mockResolvedValue('new-id');
  mockUpdateCareLog.mockReset().mockResolvedValue(undefined);
  mockGetCareLog.mockReset();
});

describe('作業を記録（?kind= つき）', () => {
  it('kind を選択済みで開く', () => {
    mockParams = { id: 'p1', kind: 'fertilize' };
    render(<NewCareLogScreen />);

    fireEvent.press(screen.getByText('記録'));

    return waitFor(() =>
      expect(mockCreateCareLog).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'fertilize' }),
      ),
    );
  });

  it('知らない kind は無視して既定（水やり）にする', async () => {
    mockParams = { id: 'p1', kind: 'こわれた値' };
    render(<NewCareLogScreen />);

    fireEvent.press(screen.getByText('記録'));

    await waitFor(() =>
      expect(mockCreateCareLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'water' })),
    );
  });

  // 実機で踏んだ不具合。key が無いと 2 回目が前回の kind のまま開く
  it('続けて違う kind で開き直すと、その kind に入れ替わる', async () => {
    mockParams = { id: 'p1', kind: 'water' };
    const view = render(<NewCareLogScreen />);

    mockParams = { id: 'p1', kind: 'prune' };
    view.rerender(<NewCareLogScreen />);

    fireEvent.press(screen.getByText('記録'));

    await waitFor(() =>
      expect(mockCreateCareLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prune' })),
    );
  });
});

describe('記録を編集', () => {
  function log(overrides: Record<string, unknown> = {}) {
    return {
      id: 'care-1',
      plantingId: 'p1',
      kind: 'water',
      loggedAt: '2026-08-05T00:00:00.000Z',
      note: '朝に水やり',
      photoUris: [],
      ...overrides,
    };
  }

  it('開いた記録の内容が入っている', async () => {
    mockParams = { id: 'p1', logId: 'care-1' };
    mockGetCareLog.mockResolvedValue(log());
    render(<EditCareLogScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('朝に水やり')).toBeTruthy());
  });

  // 実機で踏んだ不具合。前のログの値のまま保存すると、別の記録を上書きしてしまう
  it('続けて別の記録を開くと、その記録の内容に入れ替わる', async () => {
    mockParams = { id: 'p1', logId: 'care-1' };
    mockGetCareLog.mockResolvedValue(log());
    const view = render(<EditCareLogScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('朝に水やり')).toBeTruthy());

    mockParams = { id: 'p1', logId: 'care-3' };
    mockGetCareLog.mockResolvedValue(
      log({
        id: 'care-3',
        kind: 'prune',
        note: 'わき芽かき',
        loggedAt: '2026-08-01T00:00:00.000Z',
      }),
    );
    view.rerender(<EditCareLogScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('わき芽かき')).toBeTruthy());
    expect(screen.queryByDisplayValue('朝に水やり')).toBeNull();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdateCareLog).toHaveBeenCalledWith(
        'care-3',
        expect.objectContaining({ kind: 'prune', note: 'わき芽かき' }),
      ),
    );
  });
});

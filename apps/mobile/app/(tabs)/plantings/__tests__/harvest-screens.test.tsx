/**
 * 収穫の記録・編集画面（R06 / WBS 2.1）。
 *
 * フォーム本体の分岐は `HarvestForm.test.tsx` が担保している。ここで見るのは
 * 画面がサービスへ渡す引数、作物ごとの**既定単位**、見つからないときの扱い、
 * 削除の確認。autoCapture は新規記録の生命線（R06「最短 3 タップ」）なので、
 * 新規 = 開く、編集 = 開かない を分けて見る。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { HarvestItem } from '../../../../src/services/types';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockCapturePhoto = jest.fn();
jest.mock('../../../../src/services/photo-capture.service', () => ({
  capturePhoto: (...args: unknown[]) => mockCapturePhoto(...args),
}));
jest.mock('../../../../src/services/photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  persistGardenPhotos: jest.fn(() => Promise.resolve(['/saved.jpg'])),
}));
jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

const mockBack = jest.fn();
const mockRouter = { back: mockBack };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockCreateHarvest = jest.fn();
const mockUpdateHarvest = jest.fn();
const mockGetHarvest = jest.fn();
const mockDeleteHarvest = jest.fn();
const mockGetDefaultUnitForPlanting = jest.fn();
jest.mock('../../../../src/services/harvest.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest.service'),
  createHarvest: (...args: unknown[]) => mockCreateHarvest(...args),
  updateHarvest: (...args: unknown[]) => mockUpdateHarvest(...args),
  getHarvest: (...args: unknown[]) => mockGetHarvest(...args),
  deleteHarvest: (...args: unknown[]) => mockDeleteHarvest(...args),
  getDefaultUnitForPlanting: (...args: unknown[]) => mockGetDefaultUnitForPlanting(...args),
}));

import NewHarvestScreen from '../[id]/harvests/new';
import EditHarvestScreen from '../[id]/harvests/[harvestId]';

function harvest(overrides: Partial<HarvestItem> & { id: string }): HarvestItem {
  return {
    plantingId: 'p1',
    harvestedAt: '2026-08-01T00:00:00.000Z',
    quantity: 3,
    unit: 'piece',
    note: '色づきが良かった',
    photoUris: [],
    ...overrides,
  };
}

function pressAlertButton(label: string) {
  const spy = Alert.alert as jest.Mock;
  const buttons = spy.mock.calls[spy.mock.calls.length - 1][2] as {
    text: string;
    onPress?: () => void;
  }[];
  const button = buttons.find((candidate) => candidate.text === label);
  if (!button) throw new Error(`ダイアログに「${label}」がありません`);
  button.onPress?.();
}

beforeEach(() => {
  mockBack.mockReset();
  mockParams = { id: 'p1' };
  mockCapturePhoto.mockReset().mockRejectedValue(new Error('cancelled'));
  mockCreateHarvest.mockReset().mockResolvedValue('new-harvest-id');
  mockUpdateHarvest.mockReset().mockResolvedValue(undefined);
  mockGetHarvest.mockReset().mockResolvedValue(harvest({ id: 'h1' }));
  mockDeleteHarvest.mockReset().mockResolvedValue(undefined);
  mockGetDefaultUnitForPlanting.mockReset().mockResolvedValue('piece');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('収穫を記録', () => {
  it('作物ごとの既定単位を選んだ状態で開く', async () => {
    mockGetDefaultUnitForPlanting.mockResolvedValue('kg');
    render(<NewHarvestScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    // 新規記録の submitLabel は「記録」（編集は既定の「保存」のまま）
    await waitFor(() => expect(screen.getByText('記録')).toBeTruthy(), { timeout: 20_000 });
    fireEvent.changeText(screen.getByLabelText('とれた量'), '2');
    fireEvent.press(screen.getByText('記録'));

    await waitFor(() =>
      expect(mockCreateHarvest).toHaveBeenCalledWith(
        expect.objectContaining({ plantingId: 'p1', unit: 'kg', quantity: 2 }),
      ),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  // R06「収穫 → カメラ → 保存の最短 3 タップ」。開いた瞬間にカメラが要る
  it('開いた瞬間にカメラを起動する', async () => {
    render(<NewHarvestScreen />);

    await waitFor(() => expect(mockCapturePhoto).toHaveBeenCalled());
  });

  it('数量を入れずに保存できる（任意入力）', async () => {
    render(<NewHarvestScreen />);
    await waitFor(() => expect(screen.getByText('記録')).toBeTruthy());

    fireEvent.press(screen.getByText('記録'));

    await waitFor(() =>
      expect(mockCreateHarvest).toHaveBeenCalledWith(
        expect.objectContaining({ plantingId: 'p1', quantity: null }),
      ),
    );
  });

  it('キャンセルで戻る', async () => {
    render(<NewHarvestScreen />);
    await waitFor(() => expect(screen.getByText('キャンセル')).toBeTruthy());

    fireEvent.press(screen.getByText('キャンセル'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('収穫を編集', () => {
  it('登録済みの内容が入っている', async () => {
    mockParams = { id: 'p1', harvestId: 'h1' };
    render(<EditHarvestScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());
    expect(screen.getByDisplayValue('色づきが良かった')).toBeTruthy();
  });

  // 編集画面で勝手にカメラが起動すると、見ているだけのつもりで撮影が走る
  it('編集画面ではカメラを起動しない', async () => {
    mockParams = { id: 'p1', harvestId: 'h1' };
    render(<EditHarvestScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());
    expect(mockCapturePhoto).not.toHaveBeenCalled();
  });

  it('見つからなければ読み込まずに戻る', async () => {
    mockParams = { id: 'p1', harvestId: 'missing' };
    mockGetHarvest.mockResolvedValue(null);
    render(<EditHarvestScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  // 続けて別の収穫を開いたときに前の内容を持ち越さない
  it('続けて別の収穫を開くと、その内容に入れ替わる', async () => {
    mockParams = { id: 'p1', harvestId: 'h1' };
    const view = render(<EditHarvestScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());

    mockParams = { id: 'p1', harvestId: 'h2' };
    mockGetHarvest.mockResolvedValue(
      harvest({ id: 'h2', quantity: 800, unit: 'g', note: '虫食いあり' }),
    );
    view.rerender(<EditHarvestScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('800')).toBeTruthy());
    expect(screen.queryByDisplayValue('3')).toBeNull();
  });

  it('保存すると harvestId を指定して更新する', async () => {
    mockParams = { id: 'p1', harvestId: 'h1' };
    render(<EditHarvestScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('3'), '5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdateHarvest).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({ quantity: 5 }),
      ),
    );
  });

  it('確認してから削除する', async () => {
    mockParams = { id: 'p1', harvestId: 'h1' };
    render(<EditHarvestScreen />);
    await waitFor(() => expect(screen.getByText('削除する')).toBeTruthy());

    fireEvent.press(screen.getByText('削除する'));
    expect(mockDeleteHarvest).not.toHaveBeenCalled();

    pressAlertButton('削除する');

    await waitFor(() => expect(mockDeleteHarvest).toHaveBeenCalledWith('h1'));
  });
});

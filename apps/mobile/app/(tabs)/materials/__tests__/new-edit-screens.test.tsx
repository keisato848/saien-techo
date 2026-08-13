/**
 * 資材の新規登録・編集画面（R12 / WBS 2.6）。
 *
 * フォーム本体の分岐は `MaterialForm.test.tsx` が担保している。ここで見るのは
 * 画面がサービスへ渡す引数、見つからないときの扱い、削除は常にできること
 * （資材は場所と違い、他の記録から参照されない）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { MaterialItem } from '../../../../src/services/types';

const mockBack = jest.fn();
const mockRouter = { back: mockBack };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockCreateMaterial = jest.fn();
const mockUpdateMaterial = jest.fn();
const mockGetMaterial = jest.fn();
const mockDeleteMaterial = jest.fn();
jest.mock('../../../../src/services/material.service', () => ({
  ...jest.requireActual('../../../../src/services/material.service'),
  createMaterial: (...args: unknown[]) => mockCreateMaterial(...args),
  updateMaterial: (...args: unknown[]) => mockUpdateMaterial(...args),
  getMaterial: (...args: unknown[]) => mockGetMaterial(...args),
  deleteMaterial: (...args: unknown[]) => mockDeleteMaterial(...args),
}));

import NewMaterialScreen from '../new';
import EditMaterialScreen from '../[id]/edit';

function material(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm1',
    name: '化成肥料 8-8-8',
    category: 'fertilizer',
    quantity: 2,
    unit: '袋',
    lowThreshold: 1,
    note: '倉庫の棚',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as MaterialItem;
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
  mockParams = {};
  mockCreateMaterial.mockReset().mockResolvedValue('new-material-id');
  mockUpdateMaterial.mockReset().mockResolvedValue(undefined);
  mockGetMaterial.mockReset().mockResolvedValue(material());
  mockDeleteMaterial.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('資材を登録', () => {
  it('名前だけで登録でき、戻る', async () => {
    render(<NewMaterialScreen />);
    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('資材を追加')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.changeText(screen.getByPlaceholderText('化成肥料 8-8-8'), '油かす');
    fireEvent.press(screen.getByText('登録'));

    await waitFor(() =>
      expect(mockCreateMaterial).toHaveBeenCalledWith(
        expect.objectContaining({ name: '油かす', category: 'fertilizer' }),
      ),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('キャンセルで戻る', async () => {
    render(<NewMaterialScreen />);
    await waitFor(() => expect(screen.getByText('キャンセル')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.press(screen.getByText('キャンセル'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('資材を編集', () => {
  it('登録済みの内容が入っている', async () => {
    mockParams = { id: 'm1' };
    render(<EditMaterialScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('化成肥料 8-8-8')).toBeTruthy());
    expect(screen.getByDisplayValue('2')).toBeTruthy();
  });

  it('見つからなければ読み込まずに戻る', async () => {
    mockParams = { id: 'missing' };
    mockGetMaterial.mockResolvedValue(null);
    render(<EditMaterialScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  // 続けて別の資材を開いたときに前の内容を持ち越さない
  it('続けて別の資材を開くと、その内容に入れ替わる', async () => {
    mockParams = { id: 'm1' };
    const view = render(<EditMaterialScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('化成肥料 8-8-8')).toBeTruthy());

    mockParams = { id: 'm2' };
    mockGetMaterial.mockResolvedValue(
      material({ id: 'm2', name: '防虫ネット', quantity: null, unit: '', note: '' }),
    );
    view.rerender(<EditMaterialScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('防虫ネット')).toBeTruthy());
    expect(screen.queryByDisplayValue('化成肥料 8-8-8')).toBeNull();
  });

  it('保存すると id を指定して更新する', async () => {
    mockParams = { id: 'm1' };
    render(<EditMaterialScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('化成肥料 8-8-8')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('残りの数量'), '5');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdateMaterial).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ name: '化成肥料 8-8-8', quantity: 5 }),
      ),
    );
  });

  it('確認してから削除する（資材は使用中でも常に削除できる）', async () => {
    mockParams = { id: 'm1' };
    render(<EditMaterialScreen />);
    await waitFor(() => expect(screen.getByText('削除する')).toBeTruthy());

    fireEvent.press(screen.getByText('削除する'));
    expect(mockDeleteMaterial).not.toHaveBeenCalled();

    pressAlertButton('削除する');

    await waitFor(() => expect(mockDeleteMaterial).toHaveBeenCalledWith('m1'));
  });
});

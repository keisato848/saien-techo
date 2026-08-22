/**
 * 場所の新規登録・編集画面（R02 / WBS 1.6）。
 *
 * フォーム本体の分岐は `PlaceForm.test.tsx` が担保している。ここで見るのは
 * 画面がサービスへ渡す引数、見つからないときの扱い、**栽培に使われている場所は
 * 削除できないこと**の出し分け。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { PlaceDetail } from '../../../../src/services/types';

const mockBack = jest.fn();
const mockRouter = { back: mockBack };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockCreatePlace = jest.fn();
const mockUpdatePlace = jest.fn();
const mockGetPlace = jest.fn();
const mockDeletePlace = jest.fn();
jest.mock('../../../../src/services/place.service', () => ({
  ...jest.requireActual('../../../../src/services/place.service'),
  createPlace: (...args: unknown[]) => mockCreatePlace(...args),
  updatePlace: (...args: unknown[]) => mockUpdatePlace(...args),
  getPlace: (...args: unknown[]) => mockGetPlace(...args),
  deletePlace: (...args: unknown[]) => mockDeletePlace(...args),
}));

import NewPlaceScreen from '../new';
import EditPlaceScreen from '../[id]/edit';

function place(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    id: 'place-1',
    name: '南の畝',
    kind: 'row',
    note: '日当たり良好',
    sortOrder: 0,
    archivedAt: null,
    plantingCount: 0,
    growingCount: 0,
    ...overrides,
  };
}

/** Alert.alert のボタンをラベルで押す */
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
  mockCreatePlace.mockReset().mockResolvedValue('new-place-id');
  mockUpdatePlace.mockReset().mockResolvedValue(undefined);
  mockGetPlace.mockReset().mockResolvedValue(place());
  mockDeletePlace.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('場所を登録', () => {
  it('名前と種類を渡して登録し、戻る', async () => {
    render(<NewPlaceScreen />);
    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('場所を追加')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.changeText(
      screen.getByPlaceholderText('南の畝 / ベランダ プランターA'),
      'ベランダ プランターB',
    );
    fireEvent.press(screen.getByText('登録'));

    await waitFor(() =>
      expect(mockCreatePlace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ベランダ プランターB', kind: 'planter' }),
      ),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('キャンセルで戻る', async () => {
    render(<NewPlaceScreen />);
    await waitFor(() => expect(screen.getByText('キャンセル')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.press(screen.getByText('キャンセル'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('場所を編集', () => {
  it('登録済みの内容が入っている', async () => {
    mockParams = { id: 'place-1' };
    render(<EditPlaceScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('南の畝')).toBeTruthy());
    expect(screen.getByDisplayValue('日当たり良好')).toBeTruthy();
  });

  it('見つからなければ読み込まずに戻る', async () => {
    mockParams = { id: 'missing' };
    mockGetPlace.mockResolvedValue(null);
    render(<EditPlaceScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  // 続けて別の場所を開いたときに前の内容を持ち越さない
  it('続けて別の場所を開くと、その内容に入れ替わる', async () => {
    mockParams = { id: 'place-1' };
    const view = render(<EditPlaceScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('南の畝')).toBeTruthy());

    mockParams = { id: 'place-2' };
    mockGetPlace.mockResolvedValue(place({ id: 'place-2', name: 'ベランダ', note: null }));
    view.rerender(<EditPlaceScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('ベランダ')).toBeTruthy());
    expect(screen.queryByDisplayValue('南の畝')).toBeNull();
  });

  it('保存すると id を指定して更新する', async () => {
    mockParams = { id: 'place-1' };
    render(<EditPlaceScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('南の畝')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('南の畝'), '南の畝（拡張）');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdatePlace).toHaveBeenCalledWith(
        'place-1',
        expect.objectContaining({ name: '南の畝（拡張）' }),
      ),
    );
  });

  it('未使用の場所は確認してから削除する', async () => {
    mockParams = { id: 'place-1' };
    mockGetPlace.mockResolvedValue(place({ plantingCount: 0 }));
    render(<EditPlaceScreen />);
    await waitFor(() => expect(screen.getByText('削除する')).toBeTruthy());

    fireEvent.press(screen.getByText('削除する'));
    expect(mockDeletePlace).not.toHaveBeenCalled();

    pressAlertButton('削除する');

    await waitFor(() => expect(mockDeletePlace).toHaveBeenCalledWith('place-1'));
  });

  // 栽培に使われている場所を消すと、過去の記録から場所名が失われる
  it('栽培に使われている場所は削除ボタンを出さず、理由を伝える', async () => {
    mockParams = { id: 'place-1' };
    mockGetPlace.mockResolvedValue(place({ plantingCount: 3 }));
    render(<EditPlaceScreen />);

    await waitFor(() => expect(screen.getByText(/栽培 3 件で使われている/)).toBeTruthy());
    expect(screen.queryByText('削除する')).toBeNull();
  });
});

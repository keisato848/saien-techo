/**
 * 栽培の新規登録・編集画面（R01 / WBS 1.5）。
 *
 * フォーム本体の分岐は `PlantingForm.test.tsx` が担保している。ここで見るのは
 * 画面がサービスへ**渡す引数**、作物ガイド経由の初期値、保存後の**遷移先**、
 * 見つからないときの扱い。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { PlantingDetail } from '../../../../src/services/types';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../../../../src/services/photo-capture.service', () => ({
  capturePhoto: jest.fn(),
}));
jest.mock('../../../../src/services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { back: mockBack, replace: mockReplace };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockCreatePlanting = jest.fn();
const mockUpdatePlanting = jest.fn();
const mockGetPlantingDetail = jest.fn();
jest.mock('../../../../src/services/planting.service', () => ({
  ...jest.requireActual('../../../../src/services/planting.service'),
  createPlanting: (...args: unknown[]) => mockCreatePlanting(...args),
  updatePlanting: (...args: unknown[]) => mockUpdatePlanting(...args),
  getPlantingDetail: (...args: unknown[]) => mockGetPlantingDetail(...args),
  // elapsedDaysFrom は純関数なので実物のまま。getPlantingTagNames は DB を叩く
  getPlantingTagNames: () => Promise.resolve([]),
}));

jest.mock('../../../../src/services/place.service', () => ({
  getPlaceList: () => Promise.resolve([]),
}));

import NewPlantingScreen from '../new';
import EditPlantingScreen from '../[id]/edit';

function detail(overrides: Partial<PlantingDetail> = {}): PlantingDetail {
  return {
    id: 'p1',
    cropName: 'トマト',
    variety: '桃太郎',
    placeName: null,
    plantedOn: '2026-05-01T00:00:00.000Z',
    plantedAs: 'seedling',
    elapsedDays: 60,
    tags: ['夏野菜'],
    coverPhotoUri: null,
    endedAt: null,
    endedReason: null,
    placeSortKey: 0,
    cropId: null,
    cropNameReading: null,
    placeId: null,
    note: 'よく育っている',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as PlantingDetail;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockParams = {};
  mockCreatePlanting.mockReset().mockResolvedValue('new-id');
  mockUpdatePlanting.mockReset().mockResolvedValue(undefined);
  mockGetPlantingDetail.mockReset().mockResolvedValue(detail());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('栽培を登録', () => {
  it('作物名だけで登録でき、詳細へ置き換える', async () => {
    render(<NewPlantingScreen />);
    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('栽培を追加')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ナス');
    fireEvent.press(screen.getByText('登録'));

    await waitFor(() =>
      expect(mockCreatePlanting).toHaveBeenCalledWith(
        expect.objectContaining({ cropName: 'ナス', plantedAs: 'seedling' }),
      ),
    );

    // トーストを見せてから遷移する。back ではなく replace — 戻ると空のフォームに戻ってしまう
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/plantings/new-id'));
  });

  // 作物ガイド（R09）の「この作物を育てはじめる」から来た経路
  it('作物ガイド経由なら作物名が入った状態で開く', async () => {
    mockParams = { cropId: 'crop-nasu', cropName: 'ナス', cropNameReading: 'なす' };
    render(<NewPlantingScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('ナス')).toBeTruthy(), {
      timeout: 20_000,
    });

    fireEvent.press(screen.getByText('登録'));

    await waitFor(() =>
      expect(mockCreatePlanting).toHaveBeenCalledWith(
        expect.objectContaining({ cropId: 'crop-nasu', cropName: 'ナス' }),
      ),
    );
  });

  it('キャンセルで戻る', async () => {
    render(<NewPlantingScreen />);
    await waitFor(() => expect(screen.getByText('キャンセル')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.press(screen.getByText('キャンセル'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('栽培を編集', () => {
  it('登録済みの内容が入っている', async () => {
    mockParams = { id: 'p1' };
    render(<EditPlantingScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('トマト')).toBeTruthy());
    expect(screen.getByDisplayValue('桃太郎')).toBeTruthy();
    expect(screen.getByDisplayValue('よく育っている')).toBeTruthy();
  });

  it('保存すると id を指定して更新し、トースト後に戻る', async () => {
    mockParams = { id: 'p1' };
    render(<EditPlantingScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('トマト')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('トマト'), 'ミニトマト');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() =>
      expect(mockUpdatePlanting).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ cropName: 'ミニトマト' }),
      ),
    );

    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('見つからなければ読み込まずに戻る', async () => {
    mockParams = { id: 'missing' };
    mockGetPlantingDetail.mockResolvedValue(null);
    render(<EditPlantingScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  // 続けて別の栽培を開いたときに前の内容を持ち越さない
  it('続けて別の栽培を開くと、その内容に入れ替わる', async () => {
    mockParams = { id: 'p1' };
    const view = render(<EditPlantingScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('トマト')).toBeTruthy());

    mockParams = { id: 'p2' };
    mockGetPlantingDetail.mockResolvedValue(
      detail({ id: 'p2', cropName: 'キュウリ', variety: null }),
    );
    view.rerender(<EditPlantingScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('キュウリ')).toBeTruthy());
    expect(screen.queryByDisplayValue('トマト')).toBeNull();
  });
});

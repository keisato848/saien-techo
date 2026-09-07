/**
 * 栽培一覧の画面テスト（R01 / R03）。
 *
 * サービスはモックし、**画面が正しい引数でサービスを呼ぶか**と
 * **空状態と一覧の出し分け**を見る。SQL の正しさはサービスのテスト側で担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { PlantingListItem } from '../../../../src/services/types';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlantingList = jest.fn();
jest.mock('../../../../src/services/planting.service', () => ({
  getPlantingList: (...args: unknown[]) => mockGetPlantingList(...args),
  getPlantingTagNames: () => Promise.resolve([]),
  PLANTING_SORTS: ['planted_desc', 'planted_asc', 'crop_name', 'place'],
  PLANTING_SORT_LABEL: {
    planted_desc: '植え付けが新しい順',
    planted_asc: '植え付けが古い順',
    crop_name: '作物名順',
    place: '場所順',
  },
}));
jest.mock('../../../../src/services/place.service', () => ({
  getPlaceList: () => Promise.resolve([]),
}));

// 「つぎの作業」の件数バッジ（レビュー 9）。並び順・絞り込みはサービスの領分なので、
// ここでは**画面が plantingId で数えて出すか**だけを見る
const mockGetNextActions = jest.fn<Promise<unknown[]>, []>(() => Promise.resolve([]));
jest.mock('../../../../src/services/next-action.service', () => ({
  getNextActions: () => mockGetNextActions(),
}));

import PlantingListScreen from '../index';

function planting(overrides: Partial<PlantingListItem> & { id: string }): PlantingListItem {
  return {
    cropName: 'トマト',
    variety: null,
    placeName: null,
    plantedOn: new Date().toISOString(),
    plantedAs: 'seedling',
    elapsedDays: 30,
    tags: [],
    coverPhotoUri: null,
    endedAt: null,
    endedReason: null,
    placeSortKey: 0,
    ...overrides,
  };
}

describe('栽培一覧', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetPlantingList.mockReset().mockResolvedValue([]);
    mockGetNextActions.mockReset().mockResolvedValue([]);
  });

  it('記録が無ければ空状態を出す', async () => {
    render(<PlantingListScreen />);
    await waitFor(() => expect(screen.getByText('まだ栽培がありません')).toBeTruthy());
  });

  it('一覧を出し、経過日数を添える', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({ id: 'p1', cropName: 'トマト', elapsedDays: 45 }),
    ]);
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.getByText('45')).toBeTruthy();
  });

  it('既定では育成中だけを引く', async () => {
    render(<PlantingListScreen />);

    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());
    expect(mockGetPlantingList.mock.calls[0][0]).toMatchObject({ onlyEnded: false });
  });

  it('「終了した栽培」に切り替えると onlyEnded で引き直す', async () => {
    render(<PlantingListScreen />);
    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());

    fireEvent.press(screen.getByText('終了した栽培'));

    await waitFor(() =>
      expect(mockGetPlantingList.mock.calls.some((call) => call[0]?.onlyEnded === true)).toBe(true),
    );
  });

  it('検索語をサービスへ渡す', async () => {
    render(<PlantingListScreen />);
    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());

    fireEvent.changeText(screen.getByPlaceholderText('作物名・品種・タグで探す'), 'とまと');

    await waitFor(() =>
      expect(mockGetPlantingList.mock.calls.some((call) => call[0]?.query === 'とまと')).toBe(true),
    );
  });

  it('検索で 0 件なら、空状態ではなく「見つかりませんでした」を出す', async () => {
    render(<PlantingListScreen />);
    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());

    fireEvent.changeText(screen.getByPlaceholderText('作物名・品種・タグで探す'), 'ダイコン');

    await waitFor(() => expect(screen.getByText('見つかりませんでした')).toBeTruthy());
  });

  it('カードから詳細へ飛ぶ', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p9', cropName: 'キュウリ' })]);
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText('キュウリ')).toBeTruthy());
    fireEvent.press(screen.getByText('キュウリ'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9');
  });

  it('＋から栽培の登録へ飛ぶ', async () => {
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByLabelText('栽培を追加')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('栽培を追加'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/new');
  });

  it('終了した栽培には終了理由を添える', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({
        id: 'p1',
        cropName: 'バジル',
        endedAt: new Date().toISOString(),
        endedReason: 'harvested',
      }),
    ]);
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText(/収穫完了/)).toBeTruthy());
  });

  // ホームのカードは上位 2 件で畳み、残りを「ほか N 件 →」でこの一覧へ送る。
  // 一覧が提案を参照していないと、飛んだ先で何も分からない
  it('提案がある株には件数バッジを出す', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({ id: 'p1', cropName: 'トマト' }),
      planting({ id: 'p2', cropName: 'ナス' }),
    ]);
    mockGetNextActions.mockResolvedValue([
      {
        plantingId: 'p1',
        cropName: 'トマト',
        kind: 'fertilize',
        elapsedDays: 40,
        thresholdDays: 30,
      },
      { plantingId: 'p1', cropName: 'トマト', kind: 'pinch', elapsedDays: 40, thresholdDays: 35 },
      { plantingId: 'p2', cropName: 'ナス', kind: 'harvest', elapsedDays: 70, thresholdDays: 60 },
    ]);
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText(/つぎの作業 2件/)).toBeTruthy());
    expect(screen.getByText(/つぎの作業 1件/)).toBeTruthy();
    expect(screen.getByLabelText('つぎの作業が2件')).toBeTruthy();
  });

  it('提案が無い株にはバッジを出さない', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p1', cropName: 'トマト' })]);
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByText(/つぎの作業/)).toBeNull();
  });

  it('提案が引けなくても一覧は出す', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p1', cropName: 'トマト' })]);
    mockGetNextActions.mockRejectedValue(new Error('DB not ready'));
    render(<PlantingListScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByText(/つぎの作業/)).toBeNull();
  });
});

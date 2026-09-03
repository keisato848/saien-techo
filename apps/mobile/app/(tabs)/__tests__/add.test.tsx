/**
 * 追加タブの画面テスト（WBS 2.9b で さいえん版に作り直し）。
 *
 * 見るのは**遷移先の分岐**: 栽培 0 件で無効になるか、1 件で直行するか、
 * 複数で選択に入るか。フォームそのものは各フォームのテストで担保している。
 */
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { PlantingListItem } from '../../../src/services/types';

// **`waitFor` の既定 1 秒では足りない。** このスイートは全体実行やビルドと
// 並走すると 1 件あたり数秒かかり、`getPlantingList` の解決が間に合わず
// 「先に栽培を追加すると」が消えないまま落ちる（2026-08-22 に pre-commit で 5 件失敗）。
// 落ちる/通るがマシンの負荷で決まるので、待ち時間を伸ばして安定させる。
configure({ asyncUtilTimeout: 10_000 });

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlantingList = jest.fn();
jest.mock('../../../src/services/planting.service', () => ({
  getPlantingList: (...args: unknown[]) => mockGetPlantingList(...args),
}));

import AddScreen from '../add';

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

describe('追加タブ', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetPlantingList.mockReset().mockResolvedValue([]);
  });

  it('4 つの入り口を出す', async () => {
    render(<AddScreen />);

    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());
    expect(screen.getByText('作業を記録')).toBeTruthy();
    expect(screen.getByText('収穫を記録')).toBeTruthy();
    expect(screen.getByText('写真から栽培を登録')).toBeTruthy();
    expect(screen.getByText('栽培を追加')).toBeTruthy();
  });

  // 栽培が 1 件でもあると「追加」タブから写真登録へ行けなくなっていた
  // （手入力フォーム内の小さいリンクだけが頼りだった・2026-09-02 実機で発見）。
  // 栽培が既にあっても押せることを固定する
  it('栽培が 1 件あっても「写真から栽培を登録」へ行ける', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p1' })]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('写真から栽培を登録'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/identify');
  });

  it('栽培が 0 件なら作業・収穫は押せず、案内を出す', async () => {
    render(<AddScreen />);
    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());

    fireEvent.press(screen.getByText('作業を記録'));
    fireEvent.press(screen.getByText('収穫を記録'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText(/先に栽培を追加すると/)).toBeTruthy();
  });

  it('栽培 0 件でも「栽培を追加」へは行ける', async () => {
    render(<AddScreen />);
    await waitFor(() => expect(mockGetPlantingList).toHaveBeenCalled());

    fireEvent.press(screen.getByText('栽培を追加'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/new');
  });

  it('栽培が 1 件なら作業フォームへ直行する（選択画面を挟まない）', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p1' })]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('作業を記録'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new'));
    expect(screen.queryByText('どの栽培の作業ですか')).toBeNull();
  });

  it('栽培が 1 件なら収穫フォームへも直行する', async () => {
    mockGetPlantingList.mockResolvedValue([planting({ id: 'p1' })]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('収穫を記録'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/new'));
  });

  it('複数あれば選択に入り、選んだ栽培のフォームへ', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({ id: 'p1', cropName: 'トマト', elapsedDays: 46 }),
      planting({ id: 'p2', cropName: 'キュウリ', elapsedDays: 31 }),
    ]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('作業を記録'));

    expect(screen.getByText('どの栽培の作業ですか')).toBeTruthy();
    expect(screen.getByText('46日目')).toBeTruthy();

    fireEvent.press(screen.getByText('キュウリ'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p2/care-logs/new');
  });

  it('収穫も選択に入る', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({ id: 'p1', cropName: 'トマト' }),
      planting({ id: 'p2', cropName: 'キュウリ' }),
    ]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('収穫を記録'));

    expect(screen.getByText('どの栽培の収穫ですか')).toBeTruthy();
    fireEvent.press(screen.getByText('トマト'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/new');
  });

  it('選択から「もどる」で 3 択に戻れる', async () => {
    mockGetPlantingList.mockResolvedValue([
      planting({ id: 'p1', cropName: 'トマト' }),
      planting({ id: 'p2', cropName: 'キュウリ' }),
    ]);
    render(<AddScreen />);
    await waitFor(() => expect(screen.queryByText(/先に栽培を追加すると/)).toBeNull());

    fireEvent.press(screen.getByText('作業を記録'));
    fireEvent.press(screen.getByLabelText('もどる'));

    expect(screen.getByText('作業を記録')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/**
 * 場所管理の画面テスト（R02 / WBS 1.6）。
 *
 * 並べ替えとアーカイブが要。どちらも**押した直後に見た目が変わらない**種類の操作で、
 * サービスを呼び忘れても・読み直しを忘れても画面は静かに前のままになる。
 * 端の行で上下が無効になることも含めて、ここで固定する。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { PlaceDetail } from '../../../../src/services/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRouter = { push: mockPush, back: mockBack };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlaceDetailList = jest.fn();
const mockMovePlace = jest.fn();
const mockArchivePlace = jest.fn();
const mockUnarchivePlace = jest.fn();
jest.mock('../../../../src/services/place.service', () => ({
  ...jest.requireActual('../../../../src/services/place.service'),
  getPlaceDetailList: (...args: unknown[]) => mockGetPlaceDetailList(...args),
  movePlace: (...args: unknown[]) => mockMovePlace(...args),
  archivePlace: (...args: unknown[]) => mockArchivePlace(...args),
  unarchivePlace: (...args: unknown[]) => mockUnarchivePlace(...args),
}));

import PlaceListScreen from '../index';

function place(overrides: Partial<PlaceDetail> & { id: string; name: string }): PlaceDetail {
  return {
    kind: 'planter',
    note: null,
    sortOrder: 0,
    archivedAt: null,
    plantingCount: 0,
    growingCount: 0,
    ...overrides,
  };
}

/** Alert.alert のボタンをラベルで押す。実機のダイアログの代わり */
function pressAlertButton(label: string) {
  const spy = Alert.alert as jest.Mock;
  const buttons = spy.mock.calls[spy.mock.calls.length - 1][2] as {
    text: string;
    onPress?: () => void;
  }[];
  const button = buttons.find((candidate) => candidate.text === label);
  if (!button) throw new Error(`ダイアログに「${label}」がありません`);
  // ダイアログのボタンは画面の外から呼ばれる。act で包まないと state 更新が警告になる
  act(() => button.onPress?.());
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockGetPlaceDetailList.mockReset().mockResolvedValue([]);
  mockMovePlace.mockReset().mockResolvedValue(undefined);
  mockArchivePlace.mockReset().mockResolvedValue(undefined);
  mockUnarchivePlace.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('場所の管理 — 一覧', () => {
  it('1 件も無ければ空状態から登録へ導く', async () => {
    render(<PlaceListScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負うため
    // waitFor 既定の 1 秒では足りない
    await waitFor(() => expect(screen.getByText('まだ場所がありません')).toBeTruthy(), {
      timeout: 20_000,
    });

    fireEvent.press(screen.getByText('場所を追加'));
    expect(mockPush).toHaveBeenCalledWith('/places/new');
  });

  it('使っている場所と使っていない場所を分けて出す', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'a', name: '南のプランター' }),
      place({ id: 'b', name: '去年の畝', archivedAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    render(<PlaceListScreen />);

    await waitFor(() => expect(screen.getByText('南のプランター')).toBeTruthy());
    expect(screen.getByText('使っていない場所')).toBeTruthy();
    expect(screen.getByText('去年の畝')).toBeTruthy();
  });

  it('全部アーカイブ済みなら、空状態ではなくその旨を出す', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'b', name: '去年の畝', archivedAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    render(<PlaceListScreen />);

    await waitFor(() => expect(screen.getByText('すべて「使わない」にしています。')).toBeTruthy());
    expect(screen.queryByText('まだ場所がありません')).toBeNull();
  });

  it('育成中があればその数を、無ければ記録数を、どちらも無ければ「栽培なし」を添える', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'a', name: '育成中あり', plantingCount: 5, growingCount: 2 }),
      place({ id: 'b', name: '記録だけ', kind: 'row', plantingCount: 3, growingCount: 0 }),
      place({ id: 'c', name: '未使用', kind: null }),
    ]);
    render(<PlaceListScreen />);

    await waitFor(() => expect(screen.getByText('プランター ・ 育成中 2')).toBeTruthy());
    expect(screen.getByText('畝 ・ 記録 3')).toBeTruthy();
    // 種別が無い場合は区切りごと落とす
    expect(screen.getByText('栽培なし')).toBeTruthy();
  });

  it('カードから編集へ飛ぶ', async () => {
    mockGetPlaceDetailList.mockResolvedValue([place({ id: 'a', name: '南のプランター' })]);
    render(<PlaceListScreen />);

    await waitFor(() => expect(screen.getByText('南のプランター')).toBeTruthy());
    fireEvent.press(screen.getByText('南のプランター'));

    expect(mockPush).toHaveBeenCalledWith('/places/a/edit');
  });

  it('＋から場所の登録へ飛ぶ', async () => {
    mockGetPlaceDetailList.mockResolvedValue([place({ id: 'a', name: '南のプランター' })]);
    render(<PlaceListScreen />);

    await waitFor(() => expect(screen.getByLabelText('場所を追加')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('場所を追加'));

    expect(mockPush).toHaveBeenCalledWith('/places/new');
  });
});

describe('場所の管理 — 並べ替え', () => {
  beforeEach(() => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'a', name: '一番目' }),
      place({ id: 'b', name: '二番目' }),
      place({ id: 'c', name: '三番目' }),
    ]);
  });

  it('上下で並べ替え、押したら読み直す', async () => {
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByText('二番目')).toBeTruthy());
    const loadsBefore = mockGetPlaceDetailList.mock.calls.length;

    fireEvent.press(screen.getByLabelText('二番目を上へ'));
    await waitFor(() => expect(mockMovePlace).toHaveBeenCalledWith('b', 'up'));

    fireEvent.press(screen.getByLabelText('二番目を下へ'));
    await waitFor(() => expect(mockMovePlace).toHaveBeenCalledWith('b', 'down'));

    // 並びはサービス側が持つ。読み直さないと画面の順序が変わらない
    await waitFor(() =>
      expect(mockGetPlaceDetailList.mock.calls.length).toBeGreaterThan(loadsBefore),
    );
  });

  it('先頭は上へ、末尾は下へ動かせない', async () => {
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByText('一番目')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('一番目を上へ'));
    fireEvent.press(screen.getByLabelText('三番目を下へ'));

    expect(mockMovePlace).not.toHaveBeenCalled();
  });

  // 並べ替えの端はアーカイブ済みを数に入れない。入れると末尾の 1 つ手前で下が死ぬ
  it('端の判定は使っている場所だけで見る', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'a', name: '一番目' }),
      place({ id: 'b', name: '二番目' }),
      place({ id: 'z', name: '使わない畝', archivedAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByText('二番目')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('二番目を下へ'));

    expect(mockMovePlace).not.toHaveBeenCalled();
  });
});

describe('場所の管理 — 使う / 使わない', () => {
  it('確認してからアーカイブし、結果を伝える', async () => {
    mockGetPlaceDetailList.mockResolvedValue([place({ id: 'a', name: '南のプランター' })]);
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByLabelText('南のプランターを使わなくする')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('南のプランターを使わなくする'));
    expect(mockArchivePlace).not.toHaveBeenCalled();

    pressAlertButton('使わなくする');

    await waitFor(() => expect(mockArchivePlace).toHaveBeenCalledWith('a'));
    await waitFor(() =>
      expect(screen.getByText('「南のプランター」を使わなくしました')).toBeTruthy(),
    );
  });

  it('キャンセルすればアーカイブしない', async () => {
    mockGetPlaceDetailList.mockResolvedValue([place({ id: 'a', name: '南のプランター' })]);
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByLabelText('南のプランターを使わなくする')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('南のプランターを使わなくする'));
    pressAlertButton('キャンセル');

    expect(mockArchivePlace).not.toHaveBeenCalled();
  });

  // 記録が残ることを言わないと「消える」と思われる。件数の有無で文面を変えている
  it('栽培の記録があるときは、記録が残ることを確認文で伝える', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'a', name: '南のプランター', plantingCount: 4 }),
    ]);
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByLabelText('南のプランターを使わなくする')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('南のプランターを使わなくする'));

    const message = (Alert.alert as jest.Mock).mock.calls[0][1] as string;
    expect(message).toContain('4 件');
    expect(message).toContain('残り');
  });

  it('使っていない場所は「戻す」で復帰でき、結果を伝える', async () => {
    mockGetPlaceDetailList.mockResolvedValue([
      place({ id: 'z', name: '去年の畝', archivedAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    render(<PlaceListScreen />);
    await waitFor(() => expect(screen.getByText('戻す')).toBeTruthy());

    fireEvent.press(screen.getByText('戻す'));

    await waitFor(() => expect(mockUnarchivePlace).toHaveBeenCalledWith('z'));
    await waitFor(() => expect(screen.getByText('「去年の畝」を戻しました')).toBeTruthy());
  });
});

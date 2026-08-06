/**
 * 買い物リストの画面テスト（R12 / WBS 2.7）。
 *
 * サービスはモックし、**チェックの向き・重複時の知らせ方・消す導線**を見る。
 * 在庫への足し戻しは garden-shopping.service のテスト側で担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { GardenShoppingItem } from '../../../../src/services/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetItems = jest.fn();
const mockAdd = jest.fn();
const mockAddLow = jest.fn();
const mockSetChecked = jest.fn();
const mockRemove = jest.fn();
const mockClearChecked = jest.fn();
jest.mock('../../../../src/services/garden-shopping.service', () => ({
  getGardenShoppingItems: (...args: unknown[]) => mockGetItems(...args),
  addGardenShoppingItem: (...args: unknown[]) => mockAdd(...args),
  addLowMaterialsToShoppingList: (...args: unknown[]) => mockAddLow(...args),
  setGardenShoppingItemChecked: (...args: unknown[]) => mockSetChecked(...args),
  removeGardenShoppingItem: (...args: unknown[]) => mockRemove(...args),
  clearCheckedGardenShoppingItems: (...args: unknown[]) => mockClearChecked(...args),
}));

import GardenShoppingScreen from '../shopping';

function item(overrides: Partial<GardenShoppingItem> & { id: string }): GardenShoppingItem {
  return {
    name: '支柱',
    amount: null,
    checked: false,
    source: 'manual',
    materialId: null,
    materialCategory: null,
    ...overrides,
  };
}

/** Alert.alert の呼び出しを覗きつつ、ボタンの onPress も叩けるようにする */
function spyAlert() {
  return jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
}

describe('買い物リスト', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockGetItems.mockReset().mockResolvedValue([]);
    mockAdd.mockReset().mockResolvedValue('new-id');
    mockAddLow.mockReset().mockResolvedValue(1);
    mockSetChecked.mockReset().mockResolvedValue(undefined);
    mockRemove.mockReset().mockResolvedValue(undefined);
    mockClearChecked.mockReset().mockResolvedValue(1);
    jest.restoreAllMocks();
  });

  it('1 件も無ければ空状態を出す', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('買うものはありません')).toBeTruthy());
  });

  it('一覧と数量を出す', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1', name: '支柱', amount: '5本' })]);
    render(<GardenShoppingScreen />);

    // 数量は名前と同じ Text にぶら下げているので、まとめて 1 行として出る
    await waitFor(() => expect(screen.getByText(/支柱/)).toBeTruthy());
    expect(screen.getByText(/5本/)).toBeTruthy();
  });

  it('入力して追加できる', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.changeText(screen.getByLabelText('買うものを入力'), '麻ひも');
    fireEvent.press(screen.getByLabelText('買い物リストに追加'));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith('麻ひも'));
  });

  it('空のままでは追加しない', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.changeText(screen.getByLabelText('買うものを入力'), '   ');
    fireEvent.press(screen.getByLabelText('買い物リストに追加'));

    await waitFor(() => expect(mockAdd).not.toHaveBeenCalled());
  });

  it('すでに入っているときは知らせる', async () => {
    const alert = spyAlert();
    mockAdd.mockResolvedValue(null);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.changeText(screen.getByLabelText('買うものを入力'), '化成肥料');
    fireEvent.press(screen.getByLabelText('買い物リストに追加'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('もう入っています', expect.any(String)));
  });

  it('追加したら入力欄を空にする（続けて書ける）', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    const input = screen.getByLabelText('買うものを入力');
    fireEvent.changeText(input, '麻ひも');
    fireEvent.press(screen.getByLabelText('買い物リストに追加'));

    await waitFor(() => expect(input.props.value).toBe(''));
  });

  it('残りわずかをまとめて入れられる', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.press(screen.getByText('残りわずかの資材をまとめて入れる'));

    await waitFor(() => expect(mockAddLow).toHaveBeenCalled());
  });

  it('入れるものが無ければ知らせる', async () => {
    const alert = spyAlert();
    mockAddLow.mockResolvedValue(0);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.press(screen.getByText('残りわずかの資材をまとめて入れる'));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('追加するものがありません', expect.any(String)),
    );
  });

  it('行を押すとチェックが付く', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1', name: '支柱' })]);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('支柱')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('支柱を買った'));

    await waitFor(() => expect(mockSetChecked).toHaveBeenCalledWith('s1', true));
  });

  it('チェック済みをもう一度押すと外れる', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1', name: '支柱', checked: true })]);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('支柱')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('支柱を買っていないことにする'));

    await waitFor(() => expect(mockSetChecked).toHaveBeenCalledWith('s1', false));
  });

  it('資材に紐づく行は、在庫が増えることを伝える', async () => {
    mockGetItems.mockResolvedValue([
      item({ id: 's1', name: '化成肥料', materialId: 'm1', materialCategory: 'fertilizer' }),
    ]);
    render(<GardenShoppingScreen />);

    // 分類のラベルと在庫の説明が 1 行に並ぶ
    await waitFor(() => expect(screen.getByText(/肥料.*買うと在庫が 1 増えます/)).toBeTruthy());
  });

  it('手で足した行には在庫の説明を出さない', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1', name: '支柱' })]);
    render(<GardenShoppingScreen />);

    await waitFor(() => expect(screen.getByText('支柱')).toBeTruthy());
    expect(screen.queryByText(/買うと在庫が 1 増えます/)).toBeNull();
  });

  it('× で 1 件消せる', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1', name: '支柱' })]);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('支柱')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('支柱をリストから消す'));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('s1'));
  });

  it('チェックが 1 つも無ければ「買ったものを消す」は出さない', async () => {
    mockGetItems.mockResolvedValue([item({ id: 's1' })]);
    render(<GardenShoppingScreen />);

    await waitFor(() => expect(screen.getByText('支柱')).toBeTruthy());
    expect(screen.queryByText('買ったものを消す')).toBeNull();
  });

  it('買ったものを消す前に確認する', async () => {
    const alert = spyAlert();
    mockGetItems.mockResolvedValue([item({ id: 's1', checked: true })]);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('買ったものを消す')).toBeTruthy());

    fireEvent.press(screen.getByText('買ったものを消す'));

    expect(alert).toHaveBeenCalledWith(
      '買ったものを消しますか',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockClearChecked).not.toHaveBeenCalled();
  });

  it('確認で「消す」を選ぶと消える', async () => {
    const alert = spyAlert();
    mockGetItems.mockResolvedValue([item({ id: 's1', checked: true })]);
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(screen.getByText('買ったものを消す')).toBeTruthy());

    fireEvent.press(screen.getByText('買ったものを消す'));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === '消す')?.onPress?.();

    await waitFor(() => expect(mockClearChecked).toHaveBeenCalled());
  });

  it('戻るで前の画面へ', async () => {
    render(<GardenShoppingScreen />);
    await waitFor(() => expect(mockGetItems).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('戻る'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

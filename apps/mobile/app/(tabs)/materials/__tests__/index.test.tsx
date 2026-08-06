/**
 * 資材一覧の画面テスト（R12 / WBS 2.6）。
 *
 * サービスはモックし、**画面が正しい引数でサービスを呼ぶか**と
 * **± の出し分け・残りわずかの表示・遷移先**を見る。
 * 在庫計算そのものは material.service のテスト側で担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { MaterialItem } from '../../../../src/services/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetMaterials = jest.fn();
const mockAdjust = jest.fn();
jest.mock('../../../../src/services/material.service', () => ({
  ...jest.requireActual('../../../../src/services/material.service'),
  getMaterials: (...args: unknown[]) => mockGetMaterials(...args),
  adjustMaterialQuantity: (...args: unknown[]) => mockAdjust(...args),
}));

import MaterialListScreen from '../index';

function material(overrides: Partial<MaterialItem> & { id: string }): MaterialItem {
  return {
    name: '化成肥料',
    category: 'fertilizer',
    quantity: null,
    unit: null,
    lowThreshold: null,
    note: null,
    ...overrides,
  };
}

describe('資材一覧', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockGetMaterials.mockReset().mockResolvedValue([]);
    mockAdjust.mockReset().mockResolvedValue(0);
  });

  it('1 件も無ければ空状態を出す', async () => {
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByText('まだ資材がありません')).toBeTruthy());
    expect(screen.getByText('資材を追加')).toBeTruthy();
  });

  it('一覧と分類のラベルを出す', async () => {
    mockGetMaterials.mockResolvedValue([
      material({ id: 'm1', name: '化成肥料 8-8-8', quantity: 1.5, unit: 'kg' }),
    ]);
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByText('化成肥料 8-8-8')).toBeTruthy());
    // しぼり込みのチップにも「肥料」があるので、カード側で 2 つ目になる
    expect(screen.getAllByText('肥料')).toHaveLength(2);
    expect(screen.getByText('1.5kg')).toBeTruthy();
  });

  it('最初はすべての分類を引く', async () => {
    render(<MaterialListScreen />);

    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());
    expect(mockGetMaterials.mock.calls[0][0]).toBeUndefined();
  });

  it('分類をしぼると、その分類でサービスを呼び直す', async () => {
    render(<MaterialListScreen />);
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());

    fireEvent.press(screen.getByText('薬剤'));

    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledWith('pesticide'));
  });

  it('同じ分類をもう一度押すと解除される', async () => {
    render(<MaterialListScreen />);
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());

    fireEvent.press(screen.getByText('薬剤'));
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledWith('pesticide'));

    fireEvent.press(screen.getByText('薬剤'));
    await waitFor(() => expect(mockGetMaterials).toHaveBeenLastCalledWith(undefined));
  });

  it('しぼり込みの結果が空なら、解除できる空状態を出す', async () => {
    render(<MaterialListScreen />);
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());

    fireEvent.press(screen.getByText('薬剤'));

    await waitFor(() => expect(screen.getByText('この分類の資材はありません')).toBeTruthy());
    expect(screen.getByText('すべて表示')).toBeTruthy();
  });

  it('数量を持つ資材には ± を出す', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1', quantity: 2, unit: '袋' })]);
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByLabelText('化成肥料を減らす')).toBeTruthy());
    expect(screen.getByLabelText('化成肥料を増やす')).toBeTruthy();
  });

  it('数量を持たない資材には ± を出さない（道具を数えさせない）', async () => {
    mockGetMaterials.mockResolvedValue([
      material({ id: 'm1', name: '移植ごて', category: 'tool', quantity: null }),
    ]);
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByText('移植ごて')).toBeTruthy());
    expect(screen.queryByLabelText('移植ごてを減らす')).toBeNull();
    expect(screen.queryByLabelText('移植ごてを増やす')).toBeNull();
  });

  it('− で 1 減らして読み直す', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1', quantity: 2, unit: '袋' })]);
    render(<MaterialListScreen />);
    await waitFor(() => expect(screen.getByLabelText('化成肥料を減らす')).toBeTruthy());

    mockGetMaterials.mockClear();
    fireEvent.press(screen.getByLabelText('化成肥料を減らす'));

    await waitFor(() => expect(mockAdjust).toHaveBeenCalledWith('m1', -1));
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());
  });

  it('＋ で 1 増やす', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1', quantity: 2, unit: '袋' })]);
    render(<MaterialListScreen />);
    await waitFor(() => expect(screen.getByLabelText('化成肥料を増やす')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('化成肥料を増やす'));

    await waitFor(() => expect(mockAdjust).toHaveBeenCalledWith('m1', 1));
  });

  it('閾値を割っていれば「残りわずか」を添える', async () => {
    mockGetMaterials.mockResolvedValue([
      material({ id: 'm1', name: 'トマトの種', category: 'seed', quantity: 1, lowThreshold: 2 }),
    ]);
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByText(/残りわずか/)).toBeTruthy());
  });

  it('閾値を割っていなければ「残りわずか」は出さない', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1', quantity: 5, lowThreshold: 2 })]);
    render(<MaterialListScreen />);

    await waitFor(() => expect(screen.getByText('化成肥料')).toBeTruthy());
    expect(screen.queryByText(/残りわずか/)).toBeNull();
  });

  it('カードを押すと編集へ', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1' })]);
    render(<MaterialListScreen />);
    await waitFor(() => expect(screen.getByText('化成肥料')).toBeTruthy());

    fireEvent.press(screen.getByText('化成肥料'));

    expect(mockPush).toHaveBeenCalledWith('/materials/m1/edit');
  });

  it('＋ボタンで追加へ', async () => {
    mockGetMaterials.mockResolvedValue([material({ id: 'm1' })]);
    render(<MaterialListScreen />);
    await waitFor(() => expect(screen.getByText('化成肥料')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('資材を追加'));

    expect(mockPush).toHaveBeenCalledWith('/materials/new');
  });

  it('空状態からも追加へ行ける', async () => {
    render(<MaterialListScreen />);
    await waitFor(() => expect(screen.getByText('まだ資材がありません')).toBeTruthy());

    fireEvent.press(screen.getByText('資材を追加'));

    expect(mockPush).toHaveBeenCalledWith('/materials/new');
  });

  it('戻るで前の画面へ', async () => {
    render(<MaterialListScreen />);
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('戻る'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * 作付け計画の画面テスト（R25 / WBS 4.7・#38）。
 *
 * サービスはモックし、**画面が正しい引数でサービスを呼ぶか**と
 * **タブの出し分け・変換ボタンの出る条件・遷移先**を見る。
 * 月の数え方そのものは planting-plan.service のテスト側で担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { PlantingPlanItem } from '../../../../../src/services/planting-plan.service';

/** 「今年」は年を省いて出す仕様なので、実行年に合わせる（年をまたいでも落ちない） */
const THIS_YEAR = new Date().getFullYear();

const mockPush = jest.fn();
const mockBack = jest.fn();
// **同じオブジェクトを返す。** 毎回作り直すと、useEffect の依存に router を
// 入れている編集画面が再読み込みを繰り返して読み込み中のまま止まる
const mockRouter = { push: mockPush, back: mockBack };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'plan-1' }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlans = jest.fn();
const mockGetPlan = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockConvert = jest.fn();
const mockSuggestions = jest.fn();
jest.mock('../../../../../src/services/planting-plan.service', () => ({
  ...jest.requireActual('../../../../../src/services/planting-plan.service'),
  getPlantingPlans: (...args: unknown[]) => mockGetPlans(...args),
  getPlantingPlan: (...args: unknown[]) => mockGetPlan(...args),
  createPlantingPlan: (...args: unknown[]) => mockCreate(...args),
  updatePlantingPlan: (...args: unknown[]) => mockUpdate(...args),
  convertPlanToPlanting: (...args: unknown[]) => mockConvert(...args),
  getPlanMonthSuggestions: (...args: unknown[]) => mockSuggestions(...args),
}));

jest.mock('../../../../../src/services/place.service', () => ({
  ...jest.requireActual('../../../../../src/services/place.service'),
  getPlaceList: () => Promise.resolve([{ id: 'place-1', name: '南の畝', kind: 'row' }]),
}));

jest.mock('../../../../../src/services/crop-guide.service', () => ({
  ...jest.requireActual('../../../../../src/services/crop-guide.service'),
  getCropGuideList: () =>
    Promise.resolve([
      {
        cropId: 'crop-nasu',
        name: 'ナス',
        nameReading: 'なす',
        family: 'ナス科',
        category: 'fruit',
        perennial: false,
        beginner: true,
        containerOk: true,
        startNow: true,
        harvestNow: false,
      },
      {
        cropId: 'crop-soramame',
        name: 'ソラマメ',
        nameReading: 'そらまめ',
        family: 'マメ科',
        category: 'bean',
        perennial: false,
        beginner: true,
        containerOk: true,
        startNow: false,
        harvestNow: false,
      },
    ]),
}));

import PlantingPlanListScreen from '../index';
import NewPlantingPlanScreen from '../new';
import EditPlantingPlanScreen from '../[id]/edit';

function plan(overrides: Partial<PlantingPlanItem> & { id: string }): PlantingPlanItem {
  return {
    cropId: null,
    cropName: 'ナス',
    cropNameReading: null,
    variety: null,
    placeId: null,
    placeName: null,
    plannedYear: THIS_YEAR,
    plannedMonth: 9,
    plannedKind: 'plant',
    note: null,
    plantingId: null,
    convertedAt: null,
    monthsUntil: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockGetPlans.mockReset().mockResolvedValue([]);
  mockGetPlan.mockReset().mockResolvedValue(null);
  mockCreate.mockReset().mockResolvedValue('plan-new');
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockConvert.mockReset().mockResolvedValue('planting-1');
  mockSuggestions.mockReset().mockResolvedValue([]);
});

describe('作付け計画の一覧', () => {
  it('1 件も無ければ空状態を出す', async () => {
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText('まだ計画がありません')).toBeTruthy());
    expect(screen.getByText('計画を追加')).toBeTruthy();
  });

  it('最初は「これから」を引く', async () => {
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(mockGetPlans).toHaveBeenCalled());
    expect(mockGetPlans).toHaveBeenCalledWith({ onlyConverted: false });
  });

  it('「植えた」に切り替えると変換済みを引き直す', async () => {
    render(<PlantingPlanListScreen />);
    await waitFor(() => expect(mockGetPlans).toHaveBeenCalled());

    fireEvent.press(screen.getByText('植えた'));

    await waitFor(() => expect(mockGetPlans).toHaveBeenCalledWith({ onlyConverted: true }));
  });

  it('計画の作物名・時期・場所を出す', async () => {
    mockGetPlans.mockResolvedValue([
      plan({
        id: 'plan-1',
        cropName: 'ソラマメ',
        plannedMonth: 10,
        monthsUntil: 1,
        placeName: '南の畝',
      }),
    ]);
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText('ソラマメ')).toBeTruthy());
    expect(screen.getByText('10月に植え付け ・ 南の畝')).toBeTruthy();
    expect(screen.getByText('来月が予定')).toBeTruthy();
  });

  it('時期が来た計画にだけ「栽培にする」を出す', async () => {
    mockGetPlans.mockResolvedValue([
      plan({ id: 'plan-1', cropName: 'ナス', monthsUntil: 0 }),
      plan({
        id: 'plan-2',
        cropName: 'トマト',
        plannedYear: THIS_YEAR + 1,
        plannedMonth: 5,
        monthsUntil: 8,
      }),
    ]);
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.getAllByText('栽培にする')).toHaveLength(1);
    expect(screen.getByLabelText('ナスを栽培にする')).toBeTruthy();
  });

  it('「栽培にする」は確認してから変換し、できた栽培へ移る', async () => {
    jest.useFakeTimers();
    mockGetPlans.mockResolvedValue([plan({ id: 'plan-1', monthsUntil: 0 })]);
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByLabelText('ナスを栽培にする')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('ナスを栽培にする'));

    // 押しただけでは作らない（栽培が 1 件できるので取り消しにくい）
    expect(mockConvert).not.toHaveBeenCalled();
    expect(screen.getByText('栽培にしますか')).toBeTruthy();

    fireEvent.press(screen.getByText('登録する'));

    await waitFor(() => expect(mockConvert).toHaveBeenCalledWith('plan-1'));
    jest.runAllTimers();
    expect(mockPush).toHaveBeenCalledWith('/plantings/planting-1');
    jest.useRealTimers();
  });

  // **失敗を黙らない。** 確認シートは押した時点で閉じるので、変換が失敗したときに
  // 何も出さないと「押したのに何も起きなかった」になる（2026-09-17 のレビュー指摘）
  it('変換に失敗したら知らせる（黙って閉じない）', async () => {
    mockGetPlans.mockResolvedValue([plan({ id: 'plan-1', monthsUntil: 0 })]);
    mockConvert.mockRejectedValue(new Error('DB が壊れている'));
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByLabelText('ナスを栽培にする')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('ナスを栽培にする'));
    fireEvent.press(screen.getByText('登録する'));

    await waitFor(() => expect(screen.getByText(/登録に失敗しました/)).toBeTruthy());
    // **タイマーを進めてから確かめる。** 成功時の遷移は 900ms の setTimeout なので、
    // 進めずに assert すると遷移を止められていなくても通ってしまう（2026-09-18 の指摘）
    jest.useFakeTimers();
    jest.advanceTimersByTime(2000);
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/plantings/planting'));
    jest.useRealTimers();
  });

  // 読み込みが失敗したときに setLoading(false) へ到達しないと、読み込み中のまま固まる
  it('計画の読み込みに失敗しても読み込み中のまま固まらない', async () => {
    mockGetPlans.mockRejectedValue(new Error('読めない'));
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText(/読み込めませんでした/)).toBeTruthy());
    expect(screen.queryByText('読み込み中')).toBeNull();
  });

  it('変換済みの行は栽培の詳細へ飛ぶ', async () => {
    mockGetPlans.mockResolvedValue([
      plan({ id: 'plan-1', cropName: 'ナス', plantingId: 'planting-9', convertedAt: '2026-09-15' }),
    ]);
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText('植えた')).toBeTruthy());
    fireEvent.press(screen.getByText('ナス'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/planting-9');
  });

  it('まだの行は編集へ飛ぶ', async () => {
    mockGetPlans.mockResolvedValue([plan({ id: 'plan-1', cropName: 'ナス' })]);
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByText('ナス')).toBeTruthy());
    fireEvent.press(screen.getByText('ナス'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/plans/plan-1/edit');
  });

  it('追加ボタンから登録画面へ', async () => {
    render(<PlantingPlanListScreen />);

    await waitFor(() => expect(screen.getByLabelText('計画を追加')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('計画を追加'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/plans/new');
  });
});

describe('作付け計画の登録', () => {
  it('入力した内容でサービスを呼び、戻る', async () => {
    render(<NewPlantingPlanScreen />);
    // 場所は非同期で読み込む
    await waitFor(() => expect(screen.getByText('南の畝')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ソラマメ');
    fireEvent.press(screen.getByText('種まき'));
    fireEvent.press(screen.getByLabelText('10月'));
    fireEvent.press(screen.getByText('南の畝'));
    fireEvent.press(screen.getByText('登録'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cropName: 'ソラマメ',
        plannedKind: 'sow',
        plannedMonth: 10,
        placeId: 'place-1',
      }),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('作物名が空なら登録しない', async () => {
    render(<NewPlantingPlanScreen />);

    fireEvent.press(screen.getByText('登録'));

    await waitFor(() => expect(screen.getByText('作物名は必須です')).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('作物マスターから選ぶと作物名が入る', async () => {
    render(<NewPlantingPlanScreen />);

    await waitFor(() => expect(screen.getByLabelText('作物から選ぶ')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('作物から選ぶ'));

    // 既定の分類は「実もの」。ナスが並び、今月が始めどきの印が付く
    expect(screen.getByText('今月が始めどき')).toBeTruthy();
    fireEvent.press(screen.getByText('ナス'));

    expect(screen.getByDisplayValue('ナス')).toBeTruthy();
  });

  it('暦の候補を押すと、種類と年月がまとめて入る', async () => {
    mockSuggestions.mockResolvedValue([
      { kind: 'sow', startMonth: 10, endMonth: 11, year: THIS_YEAR },
    ]);
    render(<NewPlantingPlanScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ソラマメ');
    await waitFor(() => expect(screen.getByText('種まき 10〜11月')).toBeTruthy());

    fireEvent.press(screen.getByText('種まき 10〜11月'));
    fireEvent.press(screen.getByText('登録'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ plannedKind: 'sow', plannedYear: THIS_YEAR, plannedMonth: 10 }),
    );
  });
});

describe('作付け計画の編集', () => {
  it('読み込めなければ戻す', async () => {
    render(<EditPlantingPlanScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('既存の内容を入れて開き、保存でサービスを呼ぶ', async () => {
    mockGetPlan.mockResolvedValue(
      plan({ id: 'plan-1', cropName: 'ソラマメ', plannedMonth: 10, plannedKind: 'sow' }),
    );
    render(<EditPlantingPlanScreen />);

    await waitFor(() => expect(screen.getByDisplayValue('ソラマメ')).toBeTruthy());
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({ cropName: 'ソラマメ', plannedMonth: 10, plannedKind: 'sow' }),
    );
  });
});

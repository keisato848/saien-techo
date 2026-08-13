/**
 * 栽培詳細の画面テスト（R01 / R04 / R06 / R10）。
 *
 * この画面は**育成中と終了済みで出し分けるものが多い**（クイック記録・つぎの作業・
 * お知らせ・終了/再開ボタン）。出し分けを間違えても警告は出ず、
 * 「設定できるのに通知が来ない」のような静かな不整合になるので、ここで固定する。
 *
 * サービスはモックし、**画面が正しい引数でサービスを呼ぶか**と
 * **どこへ遷移するか**を見る。SQL の正しさはサービスのテスト側で担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type {
  CareLogItem,
  HarvestItem,
  PlantingDetail,
  ReminderItem,
} from '../../../../src/services/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
// 実物の useRouter は同じオブジェクトを返す。毎回作り直すと
// 依存配列に入れている画面が読み込みを繰り返し、実機と挙動がずれる
const mockRouter = { push: mockPush, back: mockBack, replace: mockReplace };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'p1' }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetPlantingDetail = jest.fn();
const mockEndPlanting = jest.fn();
const mockResumePlanting = jest.fn();
const mockDeletePlanting = jest.fn();
jest.mock('../../../../src/services/planting.service', () => ({
  getPlantingDetail: (...args: unknown[]) => mockGetPlantingDetail(...args),
  endPlanting: (...args: unknown[]) => mockEndPlanting(...args),
  resumePlanting: (...args: unknown[]) => mockResumePlanting(...args),
  deletePlanting: (...args: unknown[]) => mockDeletePlanting(...args),
}));

const mockGetCareLogs = jest.fn();
const mockCreateCareLog = jest.fn();
jest.mock('../../../../src/services/care-log.service', () => ({
  ...jest.requireActual('../../../../src/services/care-log.service'),
  getCareLogs: (...args: unknown[]) => mockGetCareLogs(...args),
  createCareLog: (...args: unknown[]) => mockCreateCareLog(...args),
}));

const mockGetHarvests = jest.fn();
const mockGetHarvestTotals = jest.fn();
jest.mock('../../../../src/services/harvest.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest.service'),
  getHarvests: (...args: unknown[]) => mockGetHarvests(...args),
  getHarvestTotals: (...args: unknown[]) => mockGetHarvestTotals(...args),
}));

const mockGetReminders = jest.fn();
jest.mock('../../../../src/services/reminder.service', () => ({
  getReminders: (...args: unknown[]) => mockGetReminders(...args),
}));

const mockGetNextActions = jest.fn();
jest.mock('../../../../src/services/next-action.service', () => ({
  ...jest.requireActual('../../../../src/services/next-action.service'),
  getNextActionsForPlanting: (...args: unknown[]) => mockGetNextActions(...args),
}));

import PlantingDetailScreen from '../[id]';

function detail(overrides: Partial<PlantingDetail> = {}): PlantingDetail {
  return {
    id: 'p1',
    cropName: 'トマト',
    variety: '桃太郎',
    placeName: 'ベランダ',
    plantedOn: '2026-05-01T00:00:00.000Z',
    plantedAs: 'seedling',
    elapsedDays: 60,
    tags: [],
    coverPhotoUri: null,
    endedAt: null,
    endedReason: null,
    placeSortKey: 0,
    cropId: 'crop-tomato',
    cropNameReading: 'とまと',
    placeId: 'place-1',
    note: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as PlantingDetail;
}

function careLog(overrides: Partial<CareLogItem> & { id: string }): CareLogItem {
  return {
    plantingId: 'p1',
    kind: 'water',
    loggedAt: '2026-06-01T00:00:00.000Z',
    note: null,
    photoUris: [],
    ...overrides,
  };
}

function harvest(overrides: Partial<HarvestItem> & { id: string }): HarvestItem {
  return {
    plantingId: 'p1',
    harvestedAt: '2026-07-01T00:00:00.000Z',
    quantity: null,
    unit: null,
    note: null,
    photoUris: [],
    ...overrides,
  };
}

function reminder(overrides: Partial<ReminderItem> & { id: string }): ReminderItem {
  return {
    plantingId: 'p1',
    kind: 'water',
    scheduleKind: 'daily',
    intervalDays: null,
    weekdays: [],
    hour: 7,
    minute: 0,
    enabled: true,
    lastFiredAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockGetPlantingDetail.mockReset().mockResolvedValue(detail());
  mockEndPlanting.mockReset().mockResolvedValue(undefined);
  mockResumePlanting.mockReset().mockResolvedValue(undefined);
  mockDeletePlanting.mockReset().mockResolvedValue(undefined);
  mockGetCareLogs.mockReset().mockResolvedValue([]);
  mockCreateCareLog.mockReset().mockResolvedValue('care-new');
  mockGetHarvests.mockReset().mockResolvedValue([]);
  mockGetHarvestTotals.mockReset().mockResolvedValue([]);
  mockGetReminders.mockReset().mockResolvedValue([]);
  mockGetNextActions.mockReset().mockResolvedValue([]);
});

describe('栽培詳細 — 表示', () => {
  it('登録した内容を出す', async () => {
    render(<PlantingDetailScreen />);

    // このファイルで最初に render する 1 本。画面が引き込むモジュール群の読み込みを
    // ここが丸ごと背負うため、waitFor 既定の 1 秒では Loading のまま落ちる（実測 18 秒）
    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy(), { timeout: 20_000 });
    expect(screen.getByText('桃太郎')).toBeTruthy();
    expect(screen.getByText('60')).toBeTruthy();
    expect(screen.getByText('ベランダ')).toBeTruthy();
    expect(screen.getByText('苗から')).toBeTruthy();
  });

  it('場所が未設定なら「未設定」と出す（空欄にしない）', async () => {
    mockGetPlantingDetail.mockResolvedValue(detail({ placeName: null, placeId: null }));
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('未設定')).toBeTruthy());
  });

  it('見つからなければ戻る導線だけを出す', async () => {
    mockGetPlantingDetail.mockResolvedValue(null);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('この栽培は見つかりませんでした')).toBeTruthy());
    fireEvent.press(screen.getByText('戻る'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('作業ログが無ければその旨を出す', async () => {
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('まだ記録がありません。')).toBeTruthy());
  });

  it('作業ログの行から編集へ飛ぶ', async () => {
    mockGetCareLogs.mockResolvedValue([
      careLog({ id: 'care-9', kind: 'prune', note: 'わき芽かき' }),
    ]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('わき芽かき')).toBeTruthy());
    fireEvent.press(screen.getByText('わき芽かき'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/care-9');
  });

  it('収穫が無ければ収穫セクションごと出さない', async () => {
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByText('収穫 ›')).toBeNull();
  });

  it('収穫があれば合計を単位ごとに出し、セルから詳細へ飛ぶ', async () => {
    mockGetHarvests.mockResolvedValue([harvest({ id: 'h1', quantity: 3, unit: 'piece' })]);
    mockGetHarvestTotals.mockResolvedValue([
      { unit: 'piece', quantity: 12 },
      { unit: 'g', quantity: 800 },
    ]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('12個')).toBeTruthy());
    expect(screen.getByText('800g')).toBeTruthy();

    fireEvent.press(screen.getByText('3個'));
    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/h1');
  });

  it('停止中のお知らせにはその旨を添える', async () => {
    mockGetReminders.mockResolvedValue([reminder({ id: 'r1', enabled: false })]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText(/毎日 7:00（停止中）/)).toBeTruthy());
  });

  // つぎの作業はガイド由来で、栽培によっては引けない。落ちたら画面ごと空になる
  it('つぎの作業の取得に失敗しても画面は描ける', async () => {
    mockGetNextActions.mockRejectedValue(new Error('guide missing'));
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
  });
});

describe('栽培詳細 — 記録の導線', () => {
  it('クイック記録は 1 タップで保存し、結果を伝える', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('水やりを記録')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('水やりを記録'));

    await waitFor(() =>
      expect(mockCreateCareLog).toHaveBeenCalledWith({ plantingId: 'p1', kind: 'water' }),
    );
    // 保存したら読み直す。読み直さないと今つけた記録が一覧に出ない
    await waitFor(() => expect(mockGetCareLogs.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText('水やりを記録しました')).toBeTruthy();
  });

  it('収穫は作業ログではなく収穫の記録画面へ送る', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('収穫を記録')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('収穫を記録'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/new');
  });

  it('つぎの作業「追肥」は kind を選択済みで記録画面を開く', async () => {
    mockGetNextActions.mockResolvedValue([
      {
        plantingId: 'p1',
        cropName: 'トマト',
        kind: 'fertilize',
        elapsedDays: 60,
        thresholdDays: 45,
      },
    ]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('追肥を記録する')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('追肥を記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/care-logs/new?kind=fertilize');
  });

  it('つぎの作業「収穫」は収穫の記録画面を開く', async () => {
    mockGetNextActions.mockResolvedValue([
      { plantingId: 'p1', cropName: 'トマト', kind: 'harvest', elapsedDays: 60, thresholdDays: 55 },
    ]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('収穫を記録する')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('収穫を記録する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/harvests/new');
  });

  it('AI 相談へ飛ぶ', async () => {
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('AI に相談する')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('AI に相談する'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/consult');
  });
});

describe('栽培詳細 — 終了と再開', () => {
  it('終了は理由を選ばせてから確定する', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByText('栽培を終了する')).toBeTruthy());

    // シートを開くだけでは終了しない
    fireEvent.press(screen.getByText('栽培を終了する'));
    expect(mockEndPlanting).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('枯れた'));

    await waitFor(() => expect(mockEndPlanting).toHaveBeenCalledWith('p1', 'died'));
    // トーストは読み直しの後。end の呼び出しだけを待つと間に合わない
    await waitFor(() => expect(screen.getByText('栽培を終了しました')).toBeTruthy());
  });

  it('終了済みなら理由つきのバナーを出し、記録の導線を引っ込める', async () => {
    mockGetPlantingDetail.mockResolvedValue(
      detail({ endedAt: '2026-07-20T00:00:00.000Z', endedReason: 'harvested' }),
    );
    mockGetReminders.mockResolvedValue([reminder({ id: 'r1' })]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText(/収穫完了/)).toBeTruthy());
    expect(screen.queryByText('やった！を記録')).toBeNull();
    // 通知は終了した栽培には飛ばない。設定だけ出すと「来ないのに設定できる」になる
    expect(screen.queryByText('お知らせ')).toBeNull();
    expect(screen.queryByText('栽培を終了する')).toBeNull();
    expect(screen.getByText('育成中に戻す')).toBeTruthy();
  });

  it('終了済みではつぎの作業を出さない', async () => {
    mockGetPlantingDetail.mockResolvedValue(
      detail({ endedAt: '2026-07-20T00:00:00.000Z', endedReason: 'harvested' }),
    );
    mockGetNextActions.mockResolvedValue([
      { plantingId: 'p1', cropName: 'トマト', kind: 'harvest', elapsedDays: 60, thresholdDays: 55 },
    ]);
    render(<PlantingDetailScreen />);

    await waitFor(() => expect(screen.getByText('育成中に戻す')).toBeTruthy());
    expect(screen.queryByLabelText('収穫を記録する')).toBeNull();
  });

  it('育成中に戻すと再開して読み直す', async () => {
    mockGetPlantingDetail.mockResolvedValue(
      detail({ endedAt: '2026-07-20T00:00:00.000Z', endedReason: 'other' }),
    );
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByText('育成中に戻す')).toBeTruthy());

    fireEvent.press(screen.getByText('育成中に戻す'));

    await waitFor(() => expect(mockResumePlanting).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('育成中に戻しました')).toBeTruthy());
  });
});

describe('栽培詳細 — 削除', () => {
  it('確認を挟んでから消し、一覧へ置き換える', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('この栽培を削除')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この栽培を削除'));
    expect(mockDeletePlanting).not.toHaveBeenCalled();

    // 確認シートの「削除する」はボタンと同じ文言。後から描かれる方がシート側
    const confirms = screen.getAllByText('削除する');
    fireEvent.press(confirms[confirms.length - 1]);

    await waitFor(() => expect(mockDeletePlanting).toHaveBeenCalledWith('p1'));
    // back だと消えた栽培の詳細へ戻れてしまう
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plantings');
  });

  it('確認をキャンセルすれば消さない', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('この栽培を削除')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この栽培を削除'));
    fireEvent.press(screen.getByText('キャンセル'));

    expect(mockDeletePlanting).not.toHaveBeenCalled();
    expect(screen.queryByText('キャンセル')).toBeNull();
  });
});

describe('栽培詳細 — 編集', () => {
  it('ヘッダーの鉛筆から編集画面へ飛ぶ', async () => {
    render(<PlantingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('この栽培を編集')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この栽培を編集'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p1/edit');
  });
});

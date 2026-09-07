/**
 * 収穫のふりかえりの画面テスト（R18 / WBS 4.6 / #32）。
 *
 * ここで固定したいのは「何が主役か」。
 * - 大きな数字は**回数**。数量が 1 件も無くても画面が成立すること
 * - 数量の但し書きを必ず出すこと（省くと「3 個しか採れなかった」と読まれる）
 * - 年の切り替えでサービスへ渡す年が変わること
 * - 収穫 0 件・その年だけ 0 件の 2 つの空状態を出し分けること
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  createEmptyYearSummary,
  type HarvestCropStat,
  type HarvestYearSummary,
} from '../../../../src/services/harvest-stats.service';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetHarvestYears = jest.fn();
const mockGetHarvestYearSummary = jest.fn();
jest.mock('../../../../src/services/harvest-stats.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest-stats.service'),
  getHarvestYears: (...args: unknown[]) => mockGetHarvestYears(...args),
  getHarvestYearSummary: (...args: unknown[]) => mockGetHarvestYearSummary(...args),
}));

import HarvestStatsScreen from '../stats';

const THIS_YEAR = new Date().getFullYear();

/**
 * 画面テストの待ち。既定の 1 秒では足りない —
 * 1 本目はモジュール読み込みを丸ごと背負ううえ、jest のワーカーが競り合うと
 * 状態の反映が 1 秒に間に合わず「原因の分からない失敗」になる（jest.setup.js と同じ理由）。
 */
async function waitForScreen(assertion: () => void): Promise<void> {
  await waitFor(assertion, { timeout: 20_000 });
}

function localIso(year: number, month1: number, day: number): string {
  return new Date(year, month1 - 1, day, 12, 0, 0).toISOString();
}

function cropStat(overrides: Partial<HarvestCropStat> & { cropName: string }): HarvestCropStat {
  return {
    count: 1,
    quantifiedCount: 0,
    totals: [],
    firstHarvestedAt: localIso(THIS_YEAR, 7, 1),
    lastHarvestedAt: localIso(THIS_YEAR, 7, 1),
    monthCounts: Array.from({ length: 12 }, () => 0),
    photoUri: null,
    ...overrides,
  };
}

function summary(overrides: Partial<HarvestYearSummary> = {}): HarvestYearSummary {
  return { ...createEmptyYearSummary(THIS_YEAR), ...overrides };
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockGetHarvestYears.mockReset().mockResolvedValue([THIS_YEAR]);
  mockGetHarvestYearSummary.mockReset().mockResolvedValue(summary());
});

describe('収穫のふりかえり — 空状態', () => {
  it('収穫が 1 件も無ければ記録の仕方を案内する', async () => {
    mockGetHarvestYears.mockResolvedValue([]);
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByText('まだ収穫がありません')).toBeTruthy());
  });

  // 去年は採れたが今年はまだ、という状態。「収穫がありません」と言い切ると
  // 去年のぶんまで消えたように読める
  it('その年だけ 0 件なら、年を添えた空状態にする', async () => {
    mockGetHarvestYears.mockResolvedValue([THIS_YEAR, THIS_YEAR - 1]);
    mockGetHarvestYearSummary.mockResolvedValue(summary({ count: 0 }));
    render(<HarvestStatsScreen />);

    await waitForScreen(() =>
      expect(screen.getByText(`${THIS_YEAR}年の収穫はまだありません`)).toBeTruthy(),
    );
  });
});

describe('収穫のふりかえり — 数え方の見せ方', () => {
  it('大きな数字は回数（数量が 1 件も無くても成立する）', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 7,
        quantifiedCount: 0,
        cropCount: 2,
        photoCount: 9,
        crops: [
          cropStat({ cropName: 'トマト', count: 5 }),
          cropStat({ cropName: 'ナス', count: 2 }),
        ],
      }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() =>
      expect(screen.getByLabelText(`${THIS_YEAR}年に7回採れました`)).toBeTruthy(),
    );
    expect(screen.getByText('2種類　写真9枚')).toBeTruthy();
    expect(
      screen.getByText('数量を入れた収穫はまだありません。ここでは採れた回数を数えています。'),
    ).toBeTruthy();
  });

  // 但し書きが無いと「5 個しか採れなかった」と読まれる
  it('数量のある収穫だけ合計していると断る', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 4,
        quantifiedCount: 1,
        crops: [
          cropStat({
            cropName: 'トマト',
            count: 4,
            quantifiedCount: 1,
            totals: [{ unit: 'piece', quantity: 5 }],
          }),
        ],
      }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() =>
      expect(
        screen.getByText('数量のある1件だけ合計しています（残り3件は写真だけの記録です）。'),
      ).toBeTruthy(),
    );
  });

  it('単位が混ざる作物は単位ごとに並べる（足さない）', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 2,
        quantifiedCount: 2,
        crops: [
          cropStat({
            cropName: 'ミニトマト',
            count: 2,
            quantifiedCount: 2,
            totals: [
              { unit: 'piece', quantity: 12 },
              { unit: 'g', quantity: 300 },
            ],
          }),
        ],
      }),
    );
    render(<HarvestStatsScreen />);

    // 全角スペース区切りのまま 1 つの Text に入っていること（正規表現だと
    // ライブラリ側の空白正規化に当たるので、文字列そのもので突き合わせる）
    await waitForScreen(() => expect(screen.getByText('12個　300g　初収穫 7/1')).toBeTruthy());
  });

  it('数量の無い作物は「数量の記録なし」と書く（空欄にしない）', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({ count: 1, crops: [cropStat({ cropName: 'バジル' })] }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByText(/数量の記録なし/)).toBeTruthy());
  });

  it('初収穫を日付と作物で出す', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 1,
        firstHarvest: {
          harvestId: 'h1',
          plantingId: 'p1',
          cropName: 'イチゴ',
          harvestedAt: localIso(THIS_YEAR, 5, 3),
        },
        crops: [cropStat({ cropName: 'イチゴ' })],
      }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByText(/初収穫は5月3日のイチゴ/)).toBeTruthy());
  });

  it('月ごとの収穫を読み上げられる形で出す', async () => {
    const months = createEmptyYearSummary(THIS_YEAR).months.map((month) =>
      month.month === 7 ? { ...month, count: 3, quantifiedCount: 0 } : month,
    );
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({ count: 3, months, crops: [cropStat({ cropName: 'トマト', count: 3 })] }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByLabelText('7月 3回')).toBeTruthy());
    // 0 の月も 12 か月ぶん並べる（間が空くと季節の形が分からない）
    expect(screen.getByLabelText('1月 0回')).toBeTruthy();
  });

  it('ランキングはサービスの並び順のまま順位を振る', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 3,
        crops: [cropStat({ cropName: 'トマト', count: 2 }), cropStat({ cropName: 'ナス' })],
      }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByLabelText('1位 トマト 2回')).toBeTruthy());
    expect(screen.getByLabelText('2位 ナス 1回')).toBeTruthy();
  });
});

describe('収穫のふりかえり — 年の切り替え', () => {
  it('年が 1 つだけならチップを出さない', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({ count: 1, crops: [cropStat({ cropName: 'トマト' })] }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByLabelText(`${THIS_YEAR}年`)).toBeNull();
  });

  it('年を選ぶとその年でサービスを呼び直す', async () => {
    mockGetHarvestYears.mockResolvedValue([THIS_YEAR, THIS_YEAR - 1]);
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({ count: 1, crops: [cropStat({ cropName: 'トマト' })] }),
    );
    render(<HarvestStatsScreen />);
    await waitForScreen(() => expect(screen.getByLabelText(`${THIS_YEAR - 1}年`)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(`${THIS_YEAR - 1}年`));

    await waitForScreen(() =>
      expect(mockGetHarvestYearSummary).toHaveBeenCalledWith(THIS_YEAR - 1),
    );
  });

  // 初年度の 1 月に開いたとき。空の今年を出すより去年の実りを見せる
  it('今年まだ採れていなければ直近の年を開く', async () => {
    mockGetHarvestYears.mockResolvedValue([THIS_YEAR - 1]);
    render(<HarvestStatsScreen />);

    await waitForScreen(() =>
      expect(mockGetHarvestYearSummary).toHaveBeenCalledWith(THIS_YEAR - 1),
    );
  });
});

describe('収穫のふりかえり — 写真', () => {
  it('写真から収穫の詳細へ飛ぶ', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({
        count: 1,
        photoCount: 1,
        crops: [cropStat({ cropName: 'キュウリ' })],
        highlights: [
          {
            harvestId: 'h9',
            plantingId: 'p9',
            cropName: 'キュウリ',
            harvestedAt: localIso(THIS_YEAR, 6, 12),
            photoUri: 'file:///documents/garden-photos/a.jpg',
          },
        ],
      }),
    );
    render(<HarvestStatsScreen />);
    await waitForScreen(() => expect(screen.getByLabelText('6/12のキュウリ')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('6/12のキュウリ'));

    expect(mockPush).toHaveBeenCalledWith('/plantings/p9/harvests/h9');
  });

  it('写真が 1 枚も無ければ写真の欄ごと出さない', async () => {
    mockGetHarvestYearSummary.mockResolvedValue(
      summary({ count: 1, crops: [cropStat({ cropName: 'トマト' })] }),
    );
    render(<HarvestStatsScreen />);

    await waitForScreen(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByText('この年の写真')).toBeNull();
  });
});

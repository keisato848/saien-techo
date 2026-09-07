/**
 * 作物ガイド画面のテスト（R09 / WBS 3.3）。
 * 一覧: 印の出し分けと詳細への遷移。
 * 詳細: 暦・ガイド・出典の表示と、栽培登録への引き継ぎ。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type {
  CropGuideDetail,
  CropGuideListItem,
} from '../../../../src/services/crop-guide.service';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { id: 'crop-daikon' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetList = jest.fn();
const mockGetDetail = jest.fn();
jest.mock('../../../../src/services/crop-guide.service', () => ({
  ...jest.requireActual('../../../../src/services/crop-guide.service'),
  getCropGuideList: (...args: unknown[]) => mockGetList(...args),
  getCropGuideDetail: (...args: unknown[]) => mockGetDetail(...args),
}));

import CropGuideDetailScreen, { guideFacts } from '../[id]';
import CropGuideListScreen, { matchesFilter, matchesQuery } from '../index';

function listItem(overrides: Partial<CropGuideListItem> & { cropId: string }): CropGuideListItem {
  return {
    name: 'ダイコン',
    nameReading: 'だいこん',
    family: 'アブラナ科',
    category: 'root',
    perennial: false,
    beginner: true,
    containerOk: true,
    startNow: false,
    harvestNow: false,
    ...overrides,
  };
}

function detail(overrides: Partial<CropGuideDetail> = {}): CropGuideDetail {
  return {
    cropId: 'crop-daikon',
    name: 'ダイコン',
    nameReading: 'だいこん',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    region: 'temperate',
    calendars: [
      { kind: 'sow', startMonth: 8, endMonth: 9 },
      { kind: 'harvest', startMonth: 10, endMonth: 12 },
    ],
    category: 'root',
    perennial: false,
    guide: {
      spacingCm: 25,
      sunlight: 'full',
      wateringNote: '発芽まで乾かさない。',
      wateringIntervalDays: null,
      germinationDays: null,
      transplantAfterDays: null,
      fertilizeAfterDays: 30,
      fertilizeIntervalDays: null,
      harvestAfterDays: 60,
      harvestWindow: null,
      harvestDurationDays: null,
      temperature: null,
      rotationYears: null,
      tasks: [],
      commonPests: ['アブラムシ', 'ヨトウムシ'],
      tips: '深く耕す。',
    },
    editorial: null,
    references: [
      {
        id: 'maff-sehi',
        name: '農林水産省「都道府県の施肥基準・野菜栽培技術指針」',
        url: 'https://www.maff.go.jp/j/seisan/kankyo/hozen_type/h_sehi_kizyun/',
      },
    ],
    ...overrides,
  };
}

describe('作物ガイド一覧', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockGetList.mockReset().mockResolvedValue([]);
    mockGetDetail.mockReset();
  });

  it('作物と科を並べる', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', family: 'ナス科' }),
    ]);
    render(<CropGuideListScreen />);

    await waitFor(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.getByText('トマト')).toBeTruthy();
    expect(screen.getByText('ナス科')).toBeTruthy();
  });

  it('始めどき・採りどきの印を出し分ける', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon', startNow: true }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', harvestNow: true }),
      listItem({ cropId: 'crop-ichigo', name: 'イチゴ' }),
    ]);
    render(<CropGuideListScreen />);

    await waitFor(() => expect(screen.getByText('始めどき')).toBeTruthy());
    expect(screen.getAllByText('始めどき')).toHaveLength(1);
    expect(screen.getAllByText('採りどき')).toHaveLength(1);
  });

  it('行を押すと詳細へ', async () => {
    mockGetList.mockResolvedValue([listItem({ cropId: 'crop-daikon' })]);
    render(<CropGuideListScreen />);
    await waitFor(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('ダイコンのガイド'));

    expect(mockPush).toHaveBeenCalledWith('/crops/crop-daikon');
  });

  it('分類ごとのセクションに分かれ、品目数を出す（4.19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', family: 'ナス科', category: 'fruit' }),
      listItem({ cropId: 'crop-nira', name: 'ニラ', category: 'allium', perennial: true }),
    ]);
    render(<CropGuideListScreen />);

    await waitFor(() => expect(screen.getByText('根もの')).toBeTruthy());
    expect(screen.getByText('実もの')).toBeTruthy();
    expect(screen.getByText('ネギ類')).toBeTruthy();
    expect(screen.getByText('3品目')).toBeTruthy();
    // 多年草は科の横に印
    expect(screen.getByText(/多年草/)).toBeTruthy();
  });

  it('検索欄で名前・読み・別名に当てる（4.19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({
        cropId: 'crop-togarashi',
        name: 'トウガラシ',
        nameReading: 'とうがらし',
        category: 'fruit',
      }),
    ]);
    render(<CropGuideListScreen />);
    await waitFor(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ししとう');

    await waitFor(() => expect(screen.queryByText('ダイコン')).toBeNull());
    expect(screen.getByText('トウガラシ')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ないもの');
    await waitFor(() => expect(screen.getByText(/見つかりませんでした/)).toBeTruthy());
  });

  it('「今月」チップで始めどき・採りどきだけに絞る。?now=1 なら最初から効く（4.19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon', startNow: true }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', category: 'fruit' }),
    ]);
    mockParams = { now: '1' };
    render(<CropGuideListScreen />);

    await waitFor(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.queryByText('トマト')).toBeNull();

    fireEvent.press(screen.getByLabelText('すべてで絞り込む'));
    await waitFor(() => expect(screen.getByText('トマト')).toBeTruthy());
    mockParams = { id: 'crop-daikon' };
  });
});

describe('作物ガイド一覧の絞り込み（純関数）', () => {
  it('カタカナでもひらがなでも読みに当たり、別名（シシトウ → トウガラシ）も拾う', () => {
    const daikon = listItem({ cropId: 'crop-daikon' });
    const togarashi = listItem({
      cropId: 'crop-togarashi',
      name: 'トウガラシ',
      nameReading: 'とうがらし',
    });
    expect(matchesQuery(daikon, '')).toBe(true);
    expect(matchesQuery(daikon, 'ダイ')).toBe(true);
    expect(matchesQuery(daikon, 'だいこ')).toBe(true);
    expect(matchesQuery(daikon, 'ダイコ')).toBe(true);
    expect(matchesQuery(togarashi, 'シシトウ')).toBe(true);
    expect(matchesQuery(togarashi, 'ししとう')).toBe(true);
    expect(matchesQuery(daikon, 'シシトウ')).toBe(false);
  });

  it('チップの意味', () => {
    const crop = listItem({
      cropId: 'x',
      startNow: false,
      harvestNow: true,
      beginner: false,
      containerOk: true,
    });
    expect(matchesFilter(crop, 'all')).toBe(true);
    expect(matchesFilter(crop, 'now')).toBe(true);
    expect(matchesFilter(crop, 'beginner')).toBe(false);
    expect(matchesFilter(crop, 'container')).toBe(true);
  });
});

describe('作物ガイド詳細', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetDetail.mockReset().mockResolvedValue(detail());
  });

  it('暦を種類ラベルと月範囲で出す', async () => {
    render(<CropGuideDetailScreen />);

    await waitFor(() => expect(screen.getByText('まきどき')).toBeTruthy());
    expect(screen.getByText('8〜9月')).toBeTruthy();
    expect(screen.getByText('採りどき')).toBeTruthy();
    expect(screen.getByText('10〜12月')).toBeTruthy();
  });

  it('育て方の目安（株間・日なた・日数・虫・コツ）を出す', async () => {
    render(<CropGuideDetailScreen />);

    await waitFor(() => expect(screen.getByText('株間 25cm')).toBeTruthy());
    expect(screen.getByText('日なた')).toBeTruthy();
    expect(screen.getByText('追肥 約30日後')).toBeTruthy();
    expect(screen.getByText('収穫 約60日後')).toBeTruthy();
    expect(screen.getByText('アブラムシ、ヨトウムシ')).toBeTruthy();
    expect(screen.getByText('深く耕す。')).toBeTruthy();
  });

  it('作業の目安・収穫の幅・多年草・編集者判断を札で出す（4.19）', async () => {
    mockGetDetail.mockResolvedValue(
      detail({
        guide: {
          ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
          germinationDays: 4,
          fertilizeIntervalDays: 20,
          harvestWindow: { min: 55, max: 75 },
          harvestDurationDays: 30,
          temperature: { germination: [15, 30], growth: [17, 20] },
          rotationYears: 1,
          wateringIntervalDays: 3,
          tasks: [{ kind: 'thin', afterDays: 10, note: '本葉 1 枚で' }],
        },
        editorial: { beginner: true, containerOk: true, containerDepthCm: 30 },
      }),
    );
    render(<CropGuideDetailScreen />);

    await waitFor(() => expect(screen.getByText('収穫 約55〜75日後')).toBeTruthy());
    expect(screen.getByText('発芽 約4日')).toBeTruthy();
    expect(screen.getByText('追肥 約30日後・以後20日おき')).toBeTruthy();
    expect(screen.getByText('採れる期間 約30日')).toBeTruthy();
    expect(screen.getByText('発芽 15〜30℃・生育 17〜20℃')).toBeTruthy();
    expect(screen.getByText('連作は1年あける')).toBeTruthy();
    expect(screen.getByText('水やり 3日おき')).toBeTruthy();
    expect(screen.getByText('初心者向け')).toBeTruthy();
    expect(screen.getByText('プランター 深さ30cm〜')).toBeTruthy();
    expect(screen.getByText('作業の目安')).toBeTruthy();
    expect(screen.getByText(/間引き 約10日後（本葉 1 枚で）/)).toBeTruthy();
  });

  it('多年草は「翌年から収穫」と出し、日数の札は出さない（4.19）', () => {
    const facts = guideFacts(
      detail({
        perennial: true,
        guide: {
          ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
          harvestAfterDays: null,
          rotationYears: 0,
        },
        editorial: { beginner: true, containerOk: false, containerDepthCm: null },
      }),
    );
    expect(facts).toContain('翌年から収穫（多年草）');
    expect(facts).toContain('連作OK');
    expect(facts).toContain('プランター不向き');
    expect(facts.some((f) => f.startsWith('収穫 約'))).toBe(false);
  });

  it('出典は「この作物の分」だけ出す（4.19 決定②）', async () => {
    mockGetDetail.mockResolvedValue(
      detail({
        references: [
          {
            id: 'ja-kiso-kushinsai',
            name: 'JA木曽「空芯菜」',
            url: 'https://example.invalid/kiso',
          },
        ],
      }),
    );
    render(<CropGuideDetailScreen />);

    await waitFor(() => expect(screen.getByText('JA木曽「空芯菜」')).toBeTruthy());
    expect(screen.queryByText(/都道府県の施肥基準・野菜栽培技術指針/)).toBeNull();
  });

  it('出典の一覧と免責を出す（判断②）', async () => {
    render(<CropGuideDetailScreen />);

    await waitFor(() =>
      expect(
        screen.getByText('農林水産省・JAグループ等の公開資料をもとにした目安です'),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/都道府県の施肥基準・野菜栽培技術指針/)).toBeTruthy();
    expect(screen.getByText(/品種やその年の気候によって前後します/)).toBeTruthy();
  });

  it('「育てはじめる」で作物名を引き継いで栽培登録へ', async () => {
    render(<CropGuideDetailScreen />);
    await waitFor(() => expect(screen.getByText('この作物を育てはじめる')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この作物を育てはじめる'));

    expect(mockPush).toHaveBeenCalledWith(
      `/plantings/new?cropId=crop-daikon&cropName=${encodeURIComponent('ダイコン')}&cropNameReading=${encodeURIComponent('だいこん')}`,
    );
  });

  it('地域バッジから設定へ', async () => {
    render(<CropGuideDetailScreen />);
    await waitFor(() => expect(screen.getByText('中間地')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('地域を変更'));

    expect(mockPush).toHaveBeenCalledWith('/region');
  });

  it('見つからない作物は案内を出す', async () => {
    mockGetDetail.mockResolvedValue(null);
    render(<CropGuideDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText('この作物のガイドが見つかりませんでした。')).toBeTruthy(),
    );
  });
});

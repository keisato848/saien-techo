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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ id: 'crop-daikon' }),
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

import CropGuideDetailScreen from '../[id]';
import CropGuideListScreen from '../index';

function listItem(overrides: Partial<CropGuideListItem> & { cropId: string }): CropGuideListItem {
  return {
    name: 'ダイコン',
    nameReading: 'だいこん',
    family: 'アブラナ科',
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
    guide: {
      spacingCm: 25,
      sunlight: 'full',
      wateringNote: '発芽まで乾かさない。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'ヨトウムシ'],
      tips: '深く耕す。',
    },
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

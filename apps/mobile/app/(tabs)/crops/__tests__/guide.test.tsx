/**
 * 作物ガイド画面のテスト（R09 / WBS 3.3・4.19）。
 * 一覧: 印の出し分け・絞り込み・0 件の理由・件数・読み上げラベルと詳細への遷移。
 * 詳細: 暦・ガイド（札の重み）・出典の表示と、栽培登録への引き継ぎ。
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

import CropGuideDetailScreen, { formatTemperature, guideFacts } from '../[id]';
import CropGuideListScreen, {
  describeCount,
  describeCropRowLabel,
  describeEmpty,
  filterFromParam,
  matchesFilter,
  matchesQuery,
} from '../index';

function listItem(overrides: Partial<CropGuideListItem> & { cropId: string }): CropGuideListItem {
  const name = overrides.name ?? 'ダイコン';
  return {
    name,
    // 名前を差し替えたら読みは付けない。既定の「だいこん」が残ると
    // 「ダイコン」で検索したときにトマトまで当たってしまう
    nameReading: name === 'ダイコン' ? 'だいこん' : null,
    family: 'アブラナ科',
    category: 'root',
    perennial: false,
    beginner: true,
    containerOk: true,
    sowNow: false,
    plantNow: false,
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

/** 札の text だけ取り出す（重みは別のテストで見る） */
const factTexts = (d: CropGuideDetail) => guideFacts(d).map((f) => f.text);

/**
 * 画面テストの待ち。既定の 1 秒では足りない —
 * 1 本目はモジュール読み込みを丸ごと背負ううえ、jest のワーカーが競り合うと
 * 状態の反映が 1 秒に間に合わず「原因の分からない失敗」になる
 * （harvests/stats.test.tsx と同じ理由）。
 */
async function waitForScreen(assertion: () => void): Promise<void> {
  await waitFor(assertion, { timeout: 20_000 });
}

describe('作物ガイド一覧', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockGetList.mockReset().mockResolvedValue([]);
    mockGetDetail.mockReset();
    mockParams = {};
  });

  it('作物と科を並べる', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', family: 'ナス科' }),
    ]);
    render(<CropGuideListScreen />);

    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.getByText('トマト')).toBeTruthy();
    expect(screen.getByText('ナス科')).toBeTruthy();
  });

  it('まきどき・植えどき・採りどきの印を出し分ける（4.19 レビュー 19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon', sowNow: true, startNow: true }),
      listItem({ cropId: 'crop-hakusai', name: 'ハクサイ', plantNow: true, startNow: true }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', harvestNow: true }),
      listItem({ cropId: 'crop-ichigo', name: 'イチゴ' }),
    ]);
    render(<CropGuideListScreen />);

    // チップの 1 枚 + 行の印の 1 枚
    await waitForScreen(() => expect(screen.getAllByText('まきどき')).toHaveLength(2));
    expect(screen.getAllByText('植えどき')).toHaveLength(2);
    expect(screen.getAllByText('採りどき')).toHaveLength(2);
  });

  it('行を押すと詳細へ', async () => {
    mockGetList.mockResolvedValue([listItem({ cropId: 'crop-daikon' })]);
    render(<CropGuideListScreen />);
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('ダイコンのガイド。アブラナ科'));

    expect(mockPush).toHaveBeenCalledWith('/crops/crop-daikon');
  });

  it('分類ごとのセクションに分かれ、品目数を出す（4.19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', family: 'ナス科', category: 'fruit' }),
      listItem({ cropId: 'crop-nira', name: 'ニラ', category: 'allium', perennial: true }),
    ]);
    render(<CropGuideListScreen />);

    await waitForScreen(() => expect(screen.getByText('根もの')).toBeTruthy());
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
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ししとう');

    await waitForScreen(() => expect(screen.queryByText('ダイコン')).toBeNull());
    expect(screen.getByText('トウガラシ')).toBeTruthy();
  });

  /** レビュー 11: 絞り込むと母数が分かるようにする（常に「50品目」だと 0 件の原因が読めない） */
  it('絞り込むと件数を「N品目中 M件」に変える', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon' }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', category: 'fruit' }),
    ]);
    render(<CropGuideListScreen />);
    await waitForScreen(() => expect(screen.getByText('2品目')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ダイコン');

    await waitForScreen(() => expect(screen.getByText('2品目中 1件')).toBeTruthy());
  });

  it('検索欄の X で消せる（栽培一覧と同じ手本）', async () => {
    mockGetList.mockResolvedValue([listItem({ cropId: 'crop-daikon' })]);
    render(<CropGuideListScreen />);
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ないもの');
    await waitForScreen(() => expect(screen.getByLabelText('検索を消す')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('検索を消す'));

    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.queryByLabelText('検索を消す')).toBeNull();
  });

  /** レビュー 11: 0 件の理由は 3 通りある。チップだけで 0 件になる冬が本番 */
  it('0 件のとき原因に合う文言と「絞り込みを解除」を出す', async () => {
    mockGetList.mockResolvedValue([listItem({ cropId: 'crop-daikon' })]);
    render(<CropGuideListScreen />);
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    // ① チップだけ（検索語なし）
    fireEvent.press(screen.getByLabelText('まきどきで絞り込む'));
    await waitForScreen(() =>
      expect(screen.getByText('今月まきどきの作物はありません。')).toBeTruthy(),
    );

    // ② 検索語とチップの両方
    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ナス');
    await waitForScreen(() =>
      expect(screen.getByText('「ナス」は今月のまきどきにありませんでした。')).toBeTruthy(),
    );

    // 解除すると戻る
    fireEvent.press(screen.getByLabelText('絞り込みを解除'));
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.getByText('1品目')).toBeTruthy();
  });

  it('検索語だけで 0 件なら「別の呼び方で」と言う', async () => {
    mockGetList.mockResolvedValue([listItem({ cropId: 'crop-daikon' })]);
    render(<CropGuideListScreen />);
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('作物を検索'), 'ないもの');

    await waitForScreen(() =>
      expect(
        screen.getByText(
          '「ないもの」に当たる作物がありませんでした。別の呼び方で探してみてください。',
        ),
      ).toBeTruthy(),
    );
  });

  it('?now=harvest なら「採りどき」チップが最初から効く（4.19 レビュー 19）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon', sowNow: true, startNow: true }),
      listItem({ cropId: 'crop-tomato', name: 'トマト', category: 'fruit', harvestNow: true }),
    ]);
    mockParams = { now: 'harvest' };
    render(<CropGuideListScreen />);

    await waitForScreen(() => expect(screen.getByText('トマト')).toBeTruthy());
    expect(screen.queryByText('ダイコン')).toBeNull();

    fireEvent.press(screen.getByLabelText('すべてで絞り込む'));
    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());
  });

  it('?now=sow は「まきどき」だけに絞る（植えどきは混ざらない）', async () => {
    mockGetList.mockResolvedValue([
      listItem({ cropId: 'crop-daikon', sowNow: true, startNow: true }),
      listItem({
        cropId: 'crop-hakusai',
        name: 'ハクサイ',
        category: 'leaf',
        plantNow: true,
        startNow: true,
      }),
    ]);
    mockParams = { now: 'sow' };
    render(<CropGuideListScreen />);

    await waitForScreen(() => expect(screen.getByText('ダイコン')).toBeTruthy());
    expect(screen.queryByText('ハクサイ')).toBeNull();
  });
});

describe('作物ガイド一覧の純関数', () => {
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

  it('チップの意味（まきどきと植えどきは別物）', () => {
    const sowing = listItem({ cropId: 'x', sowNow: true, startNow: true, beginner: false });
    const planting = listItem({ cropId: 'y', plantNow: true, startNow: true, beginner: false });
    const harvesting = listItem({ cropId: 'z', harvestNow: true, containerOk: false });

    expect(matchesFilter(sowing, 'all')).toBe(true);
    expect(matchesFilter(sowing, 'sow')).toBe(true);
    expect(matchesFilter(sowing, 'plant')).toBe(false);
    expect(matchesFilter(planting, 'sow')).toBe(false);
    expect(matchesFilter(planting, 'plant')).toBe(true);
    expect(matchesFilter(harvesting, 'harvest')).toBe(true);
    expect(matchesFilter(sowing, 'harvest')).toBe(false);
    expect(matchesFilter(sowing, 'beginner')).toBe(false);
    expect(matchesFilter(sowing, 'container')).toBe(true);
    expect(matchesFilter(harvesting, 'container')).toBe(false);
  });

  it('`?now=` は種別だけ受ける（旧 `1` は「すべて」に落とす）', () => {
    expect(filterFromParam('sow')).toBe('sow');
    expect(filterFromParam('plant')).toBe('plant');
    expect(filterFromParam('harvest')).toBe('harvest');
    expect(filterFromParam('1')).toBe('all');
    expect(filterFromParam(undefined)).toBe('all');
    expect(filterFromParam('beginner')).toBe('all');
  });

  it('件数は絞り込んでいるときだけ母数を添える', () => {
    expect(describeCount(50, 50)).toBe('50品目');
    expect(describeCount(50, 8)).toBe('50品目中 8件');
    expect(describeCount(50, 0)).toBe('50品目中 0件');
  });

  it('0 件の文言は原因ごとに変わる', () => {
    expect(describeEmpty('', 'sow')).toBe('今月まきどきの作物はありません。');
    expect(describeEmpty('', 'harvest')).toBe('今月採りどきの作物はありません。');
    expect(describeEmpty('', 'container')).toBe('「プランター」に当てはまる作物はありません。');
    expect(describeEmpty('ナス', 'all')).toBe(
      '「ナス」に当たる作物がありませんでした。別の呼び方で探してみてください。',
    );
    expect(describeEmpty('ナス', 'plant')).toBe('「ナス」は今月の植えどきにありませんでした。');
    expect(describeEmpty('ナス', 'beginner')).toBe(
      '「ナス」は「初心者向け」の中にありませんでした。',
    );
    expect(describeEmpty(' ', 'all')).toContain('読み込めませんでした');
  });

  it('読み上げラベルに科・多年草・今月の印を畳む（レビュー 34a）', () => {
    expect(describeCropRowLabel(listItem({ cropId: 'a' }))).toBe('ダイコンのガイド。アブラナ科');
    expect(
      describeCropRowLabel(
        listItem({
          cropId: 'b',
          name: 'ニラ',
          family: 'ヒガンバナ科',
          perennial: true,
          harvestNow: true,
        }),
      ),
    ).toBe('ニラのガイド。ヒガンバナ科、多年草、採りどき');
    expect(
      describeCropRowLabel(
        listItem({ cropId: 'c', name: 'カブ', family: null, sowNow: true, plantNow: true }),
      ),
    ).toBe('カブのガイド。まきどき、植えどき');
    expect(describeCropRowLabel(listItem({ cropId: 'd', name: 'ナゾ', family: null }))).toBe(
      'ナゾのガイド',
    );
  });
});

describe('作物ガイド詳細', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockParams = { id: 'crop-daikon' };
    mockGetDetail.mockReset().mockResolvedValue(detail());
  });

  it('暦を種類ラベルと月範囲で出す', async () => {
    render(<CropGuideDetailScreen />);

    await waitForScreen(() => expect(screen.getByText('まきどき')).toBeTruthy());
    expect(screen.getByText('8〜9月')).toBeTruthy();
    expect(screen.getByText('採りどき')).toBeTruthy();
    expect(screen.getByText('10〜12月')).toBeTruthy();
  });

  it('育て方の目安（株間・日なた・日数・虫・コツ）を出す', async () => {
    render(<CropGuideDetailScreen />);

    await waitForScreen(() => expect(screen.getByText('株間 25cm')).toBeTruthy());
    expect(screen.getByText('日なた')).toBeTruthy();
    expect(screen.getByText('追肥 約30日後')).toBeTruthy();
    expect(screen.getByText('収穫 約60日後')).toBeTruthy();
    expect(screen.getByText('アブラムシ、ヨトウムシ')).toBeTruthy();
    expect(screen.getByText('深く耕す。')).toBeTruthy();
  });

  it('作業の目安・収穫の幅・編集者判断を札で出す（4.19）', async () => {
    mockGetDetail.mockResolvedValue(
      detail({
        guide: {
          ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
          germinationDays: 4,
          fertilizeIntervalDays: 20,
          harvestWindow: { min: 55, max: 75 },
          harvestDurationDays: 30,
          rotationYears: 1,
          wateringIntervalDays: 3,
          tasks: [{ kind: 'thin', afterDays: 10, note: '本葉 1 枚で' }],
        },
        editorial: { beginner: true, containerOk: true, containerDepthCm: 30 },
      }),
    );
    render(<CropGuideDetailScreen />);

    await waitForScreen(() => expect(screen.getByText('収穫 約55〜75日後')).toBeTruthy());
    expect(screen.getByText('発芽 約4日')).toBeTruthy();
    expect(screen.getByText('追肥 約30日後・以後20日おき')).toBeTruthy();
    expect(screen.getByText('採れる期間 約30日')).toBeTruthy();
    expect(screen.getByText('連作は1年あける')).toBeTruthy();
    expect(screen.getByText('水やり 3日おき')).toBeTruthy();
    expect(screen.getByText('初心者向け')).toBeTruthy();
    expect(screen.getByText('プランター 深さ30cm〜')).toBeTruthy();
    expect(screen.getByText('作業の目安')).toBeTruthy();
    expect(screen.getByText(/間引き 約10日後（本葉 1 枚で）/)).toBeTruthy();
  });

  /** レビュー 21: 適温は 4.13 が入るまで行動が変わらないので折りたたみへ移した */
  it('適温は札に出さず、「くわしい数値」を開いたときだけ出す', async () => {
    mockGetDetail.mockResolvedValue(
      detail({
        guide: {
          ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
          temperature: { germination: [15, 30], growth: [17, 20] },
        },
      }),
    );
    render(<CropGuideDetailScreen />);
    await waitForScreen(() => expect(screen.getByText('くわしい数値')).toBeTruthy());

    expect(screen.queryByText('発芽 15〜30℃・生育 17〜20℃')).toBeNull();
    expect(factTexts(detail())).not.toContain('発芽 15〜30℃・生育 17〜20℃');

    fireEvent.press(screen.getByLabelText('くわしい数値'));

    await waitForScreen(() => expect(screen.getByText('発芽 15〜30℃・生育 17〜20℃')).toBeTruthy());
    expect(screen.getByText('適温')).toBeTruthy();
  });

  it('適温が無い作物には折りたたみごと出さない', async () => {
    render(<CropGuideDetailScreen />);
    await waitForScreen(() => expect(screen.getByText('株間 25cm')).toBeTruthy());

    expect(screen.queryByText('くわしい数値')).toBeNull();
  });

  it('多年草は「翌年から収穫」と出し、日数の札は出さない（4.19）', () => {
    const facts = factTexts(
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

  /**
   * レビュー 21: 12 種を 1 本の配列で全部同じ緑にしていたので、
   * 「これから育てるか」を決める札が制約と同じ扱いで埋もれていた。
   */
  it('札に重みを付ける — key は先頭 3 枚まで、制約は caution で最後', () => {
    const facts = guideFacts(
      detail({
        guide: {
          ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
          harvestWindow: { min: 55, max: 75 },
          rotationYears: 2,
          wateringIntervalDays: 3,
        },
        editorial: { beginner: true, containerOk: true, containerDepthCm: 30 },
      }),
    );

    expect(facts.slice(0, 3)).toEqual([
      { text: '収穫 約55〜75日後', tone: 'key' },
      { text: 'プランター 深さ30cm〜', tone: 'key' },
      { text: '日なた', tone: 'key' },
    ]);
    // key は 3 枚まで
    expect(facts.filter((f) => f.tone === 'key')).toHaveLength(3);
    // 制約は最後・緑をやめる側
    expect(facts[facts.length - 1]).toEqual({ text: '連作は2年あける', tone: 'caution' });
    expect(facts.filter((f) => f.tone === 'caution').map((f) => f.text)).toEqual([
      '連作は2年あける',
    ]);
  });

  it('プランター不向きは key ではなく caution（肯定的な事実と混ぜない）', () => {
    const facts = guideFacts(
      detail({ editorial: { beginner: false, containerOk: false, containerDepthCm: null } }),
    );
    expect(facts).toContainEqual({ text: 'プランター不向き', tone: 'caution' });
    expect(facts.filter((f) => f.tone === 'key').map((f) => f.text)).toEqual([
      '収穫 約60日後',
      '日なた',
    ]);
    // 連作 OK は制約ではないので普通の札のまま
    expect(
      guideFacts(
        detail({
          guide: {
            ...(detail().guide as NonNullable<CropGuideDetail['guide']>),
            rotationYears: 0,
          },
        }),
      ),
    ).toContainEqual({ text: '連作OK', tone: 'normal' });
  });

  it('formatTemperature の書式', () => {
    expect(formatTemperature({ germination: [15, 30], growth: [17, 20] })).toBe(
      '発芽 15〜30℃・生育 17〜20℃',
    );
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

    await waitForScreen(() => expect(screen.getByText('JA木曽「空芯菜」')).toBeTruthy());
    expect(screen.queryByText(/都道府県の施肥基準・野菜栽培技術指針/)).toBeNull();
  });

  it('出典の一覧と免責を出す（判断②）', async () => {
    render(<CropGuideDetailScreen />);

    await waitForScreen(() =>
      expect(
        screen.getByText('農林水産省・JAグループ等の公開資料をもとにした目安です'),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/都道府県の施肥基準・野菜栽培技術指針/)).toBeTruthy();
    expect(screen.getByText(/品種やその年の気候によって前後します/)).toBeTruthy();
  });

  it('「育てはじめる」で作物名を引き継いで栽培登録へ', async () => {
    render(<CropGuideDetailScreen />);
    await waitForScreen(() => expect(screen.getByText('この作物を育てはじめる')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('この作物を育てはじめる'));

    expect(mockPush).toHaveBeenCalledWith(
      `/plantings/new?cropId=crop-daikon&cropName=${encodeURIComponent('ダイコン')}&cropNameReading=${encodeURIComponent('だいこん')}`,
    );
  });

  it('地域バッジから設定へ', async () => {
    render(<CropGuideDetailScreen />);
    await waitForScreen(() => expect(screen.getByText('中間地')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('地域は中間地。変更する'));

    expect(mockPush).toHaveBeenCalledWith('/region');
  });

  it('見つからない作物は案内を出す', async () => {
    mockGetDetail.mockResolvedValue(null);
    render(<CropGuideDetailScreen />);

    await waitForScreen(() =>
      expect(screen.getByText('この作物のガイドが見つかりませんでした。')).toBeTruthy(),
    );
  });
});

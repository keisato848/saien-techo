/**
 * AI 相談に添える文脈と質問チップ（R15 / WBS 4.14・#138）。
 *
 * 見るのは 3 点:
 * - **何を送って何を送らないか**（品種・経過・場所・科・収穫の目安・直近の作業は送る／
 *   適温・連作年数・メモ本文・虫の一覧は送らない）
 * - 情報が欠けているとき（自由入力の作物・場所なし・作業ログなし）に行が消えること
 * - チップが作物のよくある虫・病気から作られ、汎用の症状が後ろに付くこと
 *
 * ガイドの値はマスターそのまま（トマト: ナス科・収穫 60 日・幅 50〜70 日・
 * 虫は アブラムシ / オオタバコガ / 尻腐れ（カルシウム不足））。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

import { syncCropMaster } from '../../db/migrate';
import {
  appendQuestionChip,
  buildConsultContext,
  buildQuestionChips,
  describeHarvestStage,
  formatDaysAgo,
  formatSeasonPoint,
  getConsultContext,
  GENERIC_QUESTION_CHIPS,
} from '../consult-context.service';
import type { PlantingDetail } from '../types';

const FAMILY_ID = 'family-001';
const NOW = new Date(2026, 8, 7, 12); // 2026-09-07

function detail(overrides: Partial<PlantingDetail> = {}): PlantingDetail {
  return {
    id: 'p1',
    cropId: 'crop-tomato',
    cropName: 'トマト',
    cropNameReading: 'とまと',
    variety: 'アイコ',
    placeId: 'place-1',
    placeName: '南のプランター',
    plantedOn: new Date(2026, 6, 1).toISOString(),
    plantedAs: 'seedling',
    elapsedDays: 42,
    tags: [],
    coverPhotoUri: null,
    endedAt: null,
    endedReason: null,
    placeSortKey: 0,
    note: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('formatDaysAgo', () => {
  it('今日・昨日・n日前', () => {
    expect(formatDaysAgo(0)).toBe('今日');
    expect(formatDaysAgo(1)).toBe('昨日');
    expect(formatDaysAgo(5)).toBe('5日前');
  });
});

describe('formatSeasonPoint', () => {
  it('上旬・中旬・下旬に丸める', () => {
    expect(formatSeasonPoint(new Date(2026, 8, 3))).toBe('9月上旬');
    expect(formatSeasonPoint(new Date(2026, 8, 20))).toBe('9月中旬');
    expect(formatSeasonPoint(new Date(2026, 8, 30))).toBe('9月下旬');
  });
});

describe('describeHarvestStage', () => {
  it('幅があるときは前・なか・過ぎたころを言い分ける', () => {
    const window = { min: 50, max: 70 };
    expect(describeHarvestStage(42, 60, window)).toBe('約50〜70日・いまは収穫期の前');
    expect(describeHarvestStage(60, 60, window)).toBe('約50〜70日・いまは収穫期のなか');
    expect(describeHarvestStage(80, 60, window)).toBe('約50〜70日・いまは収穫期を過ぎたころ');
  });

  it('幅が無ければ目安日だけで前・なかを言う', () => {
    expect(describeHarvestStage(10, 30, null)).toBe('約30日・いまは収穫期の前');
    expect(describeHarvestStage(40, 30, null)).toBe('約30日・いまは収穫期のなか');
  });

  it('多年草（目安を持たない）は何も言わない', () => {
    expect(describeHarvestStage(42, null, null)).toBeNull();
  });
});

describe('buildQuestionChips', () => {
  it('作物の虫・病気を先に、汎用の症状を後ろに置く', () => {
    const chips = buildQuestionChips(['アブラムシ', 'オオタバコガ', '尻腐れ（カルシウム不足）']);

    expect(chips.slice(0, 3)).toEqual([
      'アブラムシかもしれません',
      'オオタバコガかもしれません',
      // 括弧の補足はチップには長いので落とす
      '尻腐れかもしれません',
    ]);
    expect(chips.slice(3)).toEqual([...GENERIC_QUESTION_CHIPS]);
  });

  it('虫が分からない作物でも汎用の症状は出す', () => {
    expect(buildQuestionChips()).toEqual([...GENERIC_QUESTION_CHIPS]);
  });
});

describe('appendQuestionChip', () => {
  it('空欄なら chip そのもの', () => {
    expect(appendQuestionChip('', 'しおれてきた')).toBe('しおれてきた');
  });

  it('自由入力を消さず、行を足す', () => {
    expect(appendQuestionChip('先週から増えている', 'しおれてきた')).toBe(
      '先週から増えている\nしおれてきた',
    );
  });

  it('同じチップを二度押しても増やさない', () => {
    expect(appendQuestionChip('しおれてきた', 'しおれてきた')).toBe('しおれてきた');
  });
});

describe('buildConsultContext（純関数）', () => {
  it('情報が無いときは「いまの時期」だけが残る', () => {
    const context = buildConsultContext({
      planting: null,
      placeKind: null,
      guide: null,
      recentCareLogs: [],
      now: NOW,
    });

    expect(context.lines).toEqual([{ label: 'いまの時期', value: '9月上旬' }]);
    expect(context.chips).toEqual([...GENERIC_QUESTION_CHIPS]);
  });

  it('場所は種類だけでも名前だけでも 1 行にする', () => {
    const base = { guide: null, recentCareLogs: [], now: NOW };
    const onlyName = buildConsultContext({
      ...base,
      planting: detail({ placeName: 'ベランダ' }),
      placeKind: null,
    });
    const onlyKind = buildConsultContext({
      ...base,
      planting: detail({ placeName: null }),
      placeKind: 'row',
    });

    expect(onlyName.lines).toContainEqual({ label: '場所', value: 'ベランダ' });
    expect(onlyKind.lines).toContainEqual({ label: '場所', value: '畝' });
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('getConsultContext (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    const now = NOW.toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user-kei', 'テスト', now, now],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
    );
    await syncCropMaster(mockHandles.db);
    // 作業ログは plantings への外部キーを持つので、行そのものも要る
    mockHandles.expoDb.runSync(
      'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'p1',
        FAMILY_ID,
        'crop-tomato',
        'トマト',
        new Date(2026, 6, 1).toISOString(),
        'seedling',
        now,
        now,
      ],
    );
  });

  afterEach(() => mockHandles.close());

  function seedPlace(id: string, name: string, kind: string | null): void {
    const now = NOW.toISOString();
    mockHandles.expoDb.runSync(
      'INSERT INTO places (id, family_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, FAMILY_ID, name, kind, now, now],
    );
  }

  function seedCareLog(id: string, kind: string, daysAgo: number): void {
    const at = new Date(NOW);
    at.setDate(at.getDate() - daysAgo);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        'p1',
        kind,
        at.toISOString(),
        '個人的なメモ。これは送らない',
        NOW.toISOString(),
        NOW.toISOString(),
      ],
    );
  }

  it('品種・経過・場所・科・収穫の目安・直近の作業・時期を送る', async () => {
    seedPlace('place-1', '南のプランター', 'planter');
    seedCareLog('c1', 'water', 2);
    seedCareLog('c2', 'fertilize', 9);

    const context = await getConsultContext(detail(), NOW);

    expect(context.lines).toEqual([
      { label: '品種', value: 'アイコ' },
      { label: '経過', value: '苗から・42日目' },
      { label: '場所', value: 'プランター（南のプランター）' },
      { label: '科', value: 'ナス科' },
      { label: '収穫の目安', value: '約50〜70日・いまは収穫期の前' },
      { label: '直近の作業', value: '2日前に水やり、9日前に追肥' },
      { label: 'いまの時期', value: '9月上旬' },
    ]);
  });

  it('作業ログのメモ本文は送らない（自由文はトークンも中身も読めない）', async () => {
    seedCareLog('c1', 'water', 1);

    const context = await getConsultContext(detail({ placeId: null, placeName: null }), NOW);

    expect(JSON.stringify(context.lines)).not.toContain('個人的なメモ');
    expect(context.lines).toContainEqual({ label: '直近の作業', value: '昨日に水やり' });
  });

  it('直近 3 件までしか送らない', async () => {
    seedCareLog('c1', 'water', 1);
    seedCareLog('c2', 'water', 2);
    seedCareLog('c3', 'water', 3);
    seedCareLog('c4', 'fertilize', 4);

    const context = await getConsultContext(detail(), NOW);
    const logs = context.lines.find((line) => line.label === '直近の作業');

    expect(logs?.value).toBe('昨日に水やり、2日前に水やり、3日前に水やり');
  });

  it('マスターにない作物（自由入力）は科も収穫の目安も出さず、チップは汎用だけ', async () => {
    const context = await getConsultContext(
      detail({ cropId: null, cropName: 'ドラゴンフルーツ', variety: null, placeId: null }),
      NOW,
    );

    expect(context.lines.map((line) => line.label)).toEqual(['経過', '場所', 'いまの時期']);
    expect(context.chips).toEqual([...GENERIC_QUESTION_CHIPS]);
  });

  it('チップは作物のよくある虫・病気から作る', async () => {
    const context = await getConsultContext(detail(), NOW);

    expect(context.chips[0]).toBe('アブラムシかもしれません');
    // 虫の一覧そのものは**送らない**（写真に関係なくその名前を答える誘導になる）
    expect(JSON.stringify(context.lines)).not.toContain('アブラムシ');
  });

  it('栽培が読めないときは行を作らず、チップだけ返す', async () => {
    const context = await getConsultContext(null, NOW);

    expect(context.lines).toEqual([]);
    expect(context.chips).toEqual([...GENERIC_QUESTION_CHIPS]);
  });
});

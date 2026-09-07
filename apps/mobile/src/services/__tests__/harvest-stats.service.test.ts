/**
 * 収穫統計を実 SQLite に対してテストする（R18 / WBS 4.6 / #32）。
 *
 * ここで固定したいのは「数え方の約束」。
 * - 数量が無い収穫も**件数としては数える**（数量のあるものだけ合計する）
 * - **単位をまたいで足さない**（個と g）
 * - 年・月の境目は**端末のタイムゾーン**で決める
 * - 写真ハイライトは**月ごとに散らす**（豊作の 1 か月で埋め尽くさない）
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

// 実機では documentDirectory が入る。null だと resolvePhotoUri が素通しして
// 「解決されているか」の検証にならない
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }));

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

import { createHarvest } from '../harvest.service';
import {
  createEmptyYearSummary,
  getHarvestStatRows,
  getHarvestYears,
  getHarvestYearSummary,
  listHarvestYears,
  MAX_HIGHLIGHT_PHOTOS,
  summarizeHarvestYear,
  type HarvestStatRow,
} from '../harvest-stats.service';
import { createPlanting } from '../planting.service';

const FAMILY_ID = 'family-001';
const THIS_YEAR = new Date().getFullYear();

function seedFamily(): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
  );
}

/** 端末のタイムゾーンで年月日を決める実装に合わせ、ローカル時刻で作る */
function localIso(year: number, month1: number, day: number, hour = 12): string {
  return new Date(year, month1 - 1, day, hour, 0, 0).toISOString();
}

function row(overrides: Partial<HarvestStatRow> & { harvestId: string }): HarvestStatRow {
  return {
    plantingId: 'p1',
    cropName: 'トマト',
    harvestedAt: localIso(THIS_YEAR, 7, 10),
    quantity: null,
    unit: null,
    photoUri: null,
    photoCount: 0,
    ...overrides,
  };
}

describe('listHarvestYears', () => {
  it('収穫のあった年を新しい順に返す', () => {
    expect(
      listHarvestYears([localIso(2024, 5, 1), localIso(2026, 8, 1), localIso(2024, 9, 1)]),
    ).toEqual([2026, 2024]);
  });

  it('1 件も無ければ空', () => {
    expect(listHarvestYears([])).toEqual([]);
  });

  // toISOString() の日付で年を決めると、日本時間の元日 0 時台が前年に落ちる
  it('元日の朝は端末のタイムゾーンでその年に入る', () => {
    expect(listHarvestYears([localIso(2026, 1, 1, 6)])).toEqual([2026]);
  });
});

describe('summarizeHarvestYear — 数え方', () => {
  it('数量が無い収穫も件数には数える', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1' }),
        row({ harvestId: 'h2', quantity: 5, unit: 'piece' }),
        row({ harvestId: 'h3' }),
      ],
      THIS_YEAR,
    );

    expect(summary.count).toBe(3);
    expect(summary.quantifiedCount).toBe(1);
  });

  it('単位が違えば分けて合計する（個と g は足せない）', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', quantity: 5, unit: 'piece' }),
        row({ harvestId: 'h2', quantity: 200, unit: 'g' }),
        row({ harvestId: 'h3', quantity: 3, unit: 'piece' }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops[0].totals).toEqual([
      { unit: 'piece', quantity: 8 },
      { unit: 'g', quantity: 200 },
    ]);
  });

  it('作物が違えば合計をまとめない', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', cropName: 'トマト', quantity: 5, unit: 'piece' }),
        row({ harvestId: 'h2', cropName: 'ナス', quantity: 3, unit: 'piece' }),
      ],
      THIS_YEAR,
    );

    expect(summary.cropCount).toBe(2);
    expect(summary.crops.map((crop) => crop.totals)).toEqual([
      [{ unit: 'piece', quantity: 5 }],
      [{ unit: 'piece', quantity: 3 }],
    ]);
  });

  it('小数の合計で誤差を出さない（0.1 + 0.2）', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', quantity: 0.1, unit: 'kg' }),
        row({ harvestId: 'h2', quantity: 0.2, unit: 'kg' }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops[0].totals).toEqual([{ unit: 'kg', quantity: 0.3 }]);
  });

  it('他の年は混ざらない', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 7, 1) }),
        row({ harvestId: 'h2', harvestedAt: localIso(THIS_YEAR - 1, 7, 1) }),
      ],
      THIS_YEAR,
    );

    expect(summary.count).toBe(1);
  });

  it('1 件も無い年は 0 のサマリーを返す', () => {
    const summary = summarizeHarvestYear([], THIS_YEAR);

    expect(summary).toEqual(createEmptyYearSummary(THIS_YEAR));
    expect(summary.months).toHaveLength(12);
    expect(summary.firstHarvest).toBeNull();
  });

  it('写真の枚数は 1 件で複数枚撮ったぶんも数える', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', photoUri: '/a', photoCount: 3 }),
        row({ harvestId: 'h2', photoUri: '/b', photoCount: 1 }),
      ],
      THIS_YEAR,
    );

    expect(summary.photoCount).toBe(4);
  });
});

describe('summarizeHarvestYear — 月別', () => {
  it('12 か月ぶん返し、収穫の無い月は 0 にする', () => {
    const summary = summarizeHarvestYear(
      [row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 7, 10) })],
      THIS_YEAR,
    );

    expect(summary.months).toHaveLength(12);
    expect(summary.months[6]).toEqual({ month: 7, count: 1, quantifiedCount: 0 });
    expect(summary.months[0].count).toBe(0);
  });

  // toISOString() の日付で束ねると、月初 0 時台の記録が前月に落ちる
  it('月初の朝は端末のタイムゾーンでその月に入る', () => {
    const summary = summarizeHarvestYear(
      [row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 8, 1, 6) })],
      THIS_YEAR,
    );

    expect(summary.months[7].count).toBe(1);
  });

  it('作物ごとにも月別の回数を持つ', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 6, 5) }),
        row({ harvestId: 'h2', harvestedAt: localIso(THIS_YEAR, 8, 5) }),
        row({ harvestId: 'h3', harvestedAt: localIso(THIS_YEAR, 8, 20) }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops[0].monthCounts).toEqual([0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0]);
  });
});

describe('summarizeHarvestYear — ランキングと初収穫', () => {
  it('件数の多い順に並べる', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', cropName: 'ナス' }),
        row({ harvestId: 'h2', cropName: 'トマト' }),
        row({ harvestId: 'h3', cropName: 'トマト' }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops.map((crop) => [crop.cropName, crop.count])).toEqual([
      ['トマト', 2],
      ['ナス', 1],
    ]);
  });

  it('件数が同じなら先に採れたほうを上にする', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', cropName: 'ナス', harvestedAt: localIso(THIS_YEAR, 8, 1) }),
        row({ harvestId: 'h2', cropName: 'キュウリ', harvestedAt: localIso(THIS_YEAR, 6, 1) }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops.map((crop) => crop.cropName)).toEqual(['キュウリ', 'ナス']);
  });

  it('その年の初収穫を作物つきで返す', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', cropName: 'ナス', harvestedAt: localIso(THIS_YEAR, 8, 1) }),
        row({ harvestId: 'h2', cropName: 'イチゴ', harvestedAt: localIso(THIS_YEAR, 5, 3) }),
      ],
      THIS_YEAR,
    );

    expect(summary.firstHarvest?.cropName).toBe('イチゴ');
    expect(summary.firstHarvest?.harvestId).toBe('h2');
  });

  it('作物ごとの初収穫・最終収穫を持つ', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 9, 1) }),
        row({ harvestId: 'h2', harvestedAt: localIso(THIS_YEAR, 6, 1) }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops[0].firstHarvestedAt).toBe(localIso(THIS_YEAR, 6, 1));
    expect(summary.crops[0].lastHarvestedAt).toBe(localIso(THIS_YEAR, 9, 1));
  });

  it('数量が 1 件も無くてもランキングは出る（件数で数えるため）', () => {
    const summary = summarizeHarvestYear([row({ harvestId: 'h1' })], THIS_YEAR);

    expect(summary.crops[0].count).toBe(1);
    expect(summary.crops[0].totals).toEqual([]);
  });

  it('作物の代表写真はその年でいちばん新しいものにする', () => {
    const summary = summarizeHarvestYear(
      [
        row({ harvestId: 'h1', harvestedAt: localIso(THIS_YEAR, 6, 1), photoUri: '/old' }),
        row({ harvestId: 'h2', harvestedAt: localIso(THIS_YEAR, 9, 1), photoUri: '/new' }),
      ],
      THIS_YEAR,
    );

    expect(summary.crops[0].photoUri).toBe('/new');
  });
});

describe('summarizeHarvestYear — 写真ハイライト', () => {
  it('写真の無い収穫は並べない', () => {
    const summary = summarizeHarvestYear(
      [row({ harvestId: 'h1' }), row({ harvestId: 'h2', photoUri: '/a', photoCount: 1 })],
      THIS_YEAR,
    );

    expect(summary.highlights.map((h) => h.harvestId)).toEqual(['h2']);
  });

  // 新しい順に上から取ると、豊作だった 1 か月の写真だけが並ぶ
  it('1 か月に集中させず、月ごとに 1 枚ずつ拾う', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) =>
        row({
          harvestId: `july-${i}`,
          harvestedAt: localIso(THIS_YEAR, 7, i + 1),
          photoUri: `/july-${i}`,
          photoCount: 1,
        }),
      ),
      row({
        harvestId: 'sep-1',
        harvestedAt: localIso(THIS_YEAR, 9, 1),
        photoUri: '/sep',
        photoCount: 1,
      }),
    ];

    const summary = summarizeHarvestYear(rows, THIS_YEAR);

    expect(summary.highlights).toHaveLength(MAX_HIGHLIGHT_PHOTOS);
    expect(summary.highlights.some((h) => h.harvestId === 'sep-1')).toBe(true);
  });

  it('上限まで並べ、古い順に返す', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({
        harvestId: `h${i}`,
        harvestedAt: localIso(THIS_YEAR, (i % 12) + 1, 5),
        photoUri: `/p${i}`,
        photoCount: 1,
      }),
    );

    const summary = summarizeHarvestYear(rows, THIS_YEAR);

    expect(summary.highlights).toHaveLength(MAX_HIGHLIGHT_PHOTOS);
    const dates = summary.highlights.map((h) => h.harvestedAt);
    expect([...dates].sort()).toEqual(dates);
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('harvest-stats.service (real SQLite)', () => {
  let plantingId: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: localIso(THIS_YEAR, 4, 1),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  it('収穫が 1 件も無ければ年の一覧は空', async () => {
    expect(await getHarvestYears()).toEqual([]);
  });

  it('収穫のあった年を新しい順に返す', async () => {
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR - 1, 8, 1) });
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR, 8, 1) });

    expect(await getHarvestYears()).toEqual([THIS_YEAR, THIS_YEAR - 1]);
  });

  it('その年の行だけ読む（前後の年は入らない）', async () => {
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR - 1, 12, 31) });
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR, 1, 1, 6) });
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR, 12, 31, 22) });
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR + 1, 1, 2) });

    const summary = await getHarvestYearSummary(THIS_YEAR);

    // 大晦日の夜と元日の朝が落ちないこと（UTC で切ると片方が隣の年に行く）
    expect(summary.count).toBe(2);
    expect(summary.months[0].count).toBe(1);
    expect(summary.months[11].count).toBe(1);
  });

  it('作物名は栽培から引く（マスターに無い作物も名前でまとまる）', async () => {
    const other = await createPlanting({
      cropName: 'そら豆',
      plantedOn: localIso(THIS_YEAR, 3, 1),
      plantedAs: 'seed',
      tags: [],
    });
    await createHarvest({ plantingId, harvestedAt: localIso(THIS_YEAR, 7, 1) });
    await createHarvest({ plantingId: other, harvestedAt: localIso(THIS_YEAR, 5, 1) });

    const summary = await getHarvestYearSummary(THIS_YEAR);

    expect(summary.crops.map((crop) => crop.cropName).sort()).toEqual(['そら豆', 'トマト']);
  });

  it('写真は 1 枚目を代表にして、枚数も数える', async () => {
    await createHarvest({
      plantingId,
      harvestedAt: localIso(THIS_YEAR, 7, 1),
      photoUris: ['garden-photos/a1.jpg', 'garden-photos/a2.jpg'],
    });

    const rows = await getHarvestStatRows(THIS_YEAR);

    expect(rows).toHaveLength(1);
    expect(rows[0].photoCount).toBe(2);
    // 画面へ渡す前に絶対 URI へ戻す（相対のままだと画像が出ない）
    expect(rows[0].photoUri).toBe('file:///documents/garden-photos/a1.jpg');
  });

  it('数量と単位を読み、写真だけの収穫は合計に入れない', async () => {
    await createHarvest({
      plantingId,
      harvestedAt: localIso(THIS_YEAR, 7, 1),
      quantity: 5,
      unit: 'piece',
    });
    await createHarvest({
      plantingId,
      harvestedAt: localIso(THIS_YEAR, 7, 5),
      photoUris: ['garden-photos/x.jpg'],
    });

    const summary = await getHarvestYearSummary(THIS_YEAR);

    expect(summary.count).toBe(2);
    expect(summary.quantifiedCount).toBe(1);
    expect(summary.crops[0].totals).toEqual([{ unit: 'piece', quantity: 5 }]);
  });
});

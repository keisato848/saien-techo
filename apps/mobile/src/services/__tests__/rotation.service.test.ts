/**
 * 連作障害チェックを実 SQLite に対してテストする（R17 / WBS 4.5）。
 *
 * 科とあける年数は作物マスターそのものを使う
 * （ナス・トマト = ナス科 4 年 / カブ・コマツナ = アブラナ科 1 年 /
 *  タマネギ・ニンニク = ヒガンバナ科 0 年 = 連作 OK）。
 * ここで固定したいのは「いつ警告が出て、いつ黙るか」の境目。
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
  checkRotation,
  describeRotationWarning,
  rotationTimingLabel,
  yearsBetween,
} from '../rotation.service';

const FAMILY_ID = 'family-001';
const NOW = new Date(2026, 3, 10, 9); // 2026-04-10
const THIS_SPRING = new Date(2026, 3, 10).toISOString();

function seedBase(): void {
  const now = NOW.toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
  );
}

function seedPlace(id: string, name: string): void {
  const now = NOW.toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO places (id, family_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, FAMILY_ID, name, 'row', now, now],
  );
}

/** 過去の栽培。endedAt を渡さなければ育成中 */
function seedPlanting(
  id: string,
  cropId: string | null,
  cropName: string,
  placeId: string | null,
  plantedOn: string,
  endedAt: string | null = null,
): void {
  const now = NOW.toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO plantings (id, family_id, crop_id, crop_name, place_id, planted_on, planted_as, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, FAMILY_ID, cropId, cropName, placeId, plantedOn, 'seedling', endedAt, now, now],
  );
}

const iso = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).toISOString();

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('rotation.service (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    seedPlace('place-1', '南の畝');
    seedPlace('place-2', '北の畝');
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  it('同じ場所に去年ナス科があればトマトで警告する（4年あける目安）', async () => {
    seedPlanting('p-nasu', 'crop-nasu', 'ナス', 'place-1', iso(2025, 5, 1), iso(2025, 10, 1));

    const warning = await checkRotation({
      cropName: 'トマト',
      placeId: 'place-1',
      plantedOn: THIS_SPRING,
    });

    expect(warning).not.toBeNull();
    expect(warning).toMatchObject({
      cropName: 'トマト',
      family: 'ナス科',
      rotationYears: 4,
      placeName: '南の畝',
    });
    expect(warning?.history).toHaveLength(1);
    expect(warning?.history[0]).toMatchObject({
      plantingId: 'p-nasu',
      cropName: 'ナス',
      yearsAgo: 1,
      growing: false,
    });
  });

  it('別の場所のナス科は関係ない', async () => {
    seedPlanting('p-nasu', 'crop-nasu', 'ナス', 'place-2', iso(2025, 5, 1), iso(2025, 10, 1));

    expect(
      await checkRotation({ cropName: 'トマト', placeId: 'place-1', plantedOn: THIS_SPRING }),
    ).toBeNull();
  });

  it('あける年数を過ぎていれば黙る（アブラナ科は1年 — 去年のカブなら出ない）', async () => {
    seedPlanting('p-kabu', 'crop-kabu', 'カブ', 'place-1', iso(2025, 3, 1), iso(2025, 6, 1));

    expect(
      await checkRotation({ cropName: 'コマツナ', placeId: 'place-1', plantedOn: THIS_SPRING }),
    ).toBeNull();
  });

  it('同じ年ならアブラナ科でも警告する', async () => {
    seedPlanting('p-kabu', 'crop-kabu', 'カブ', 'place-1', iso(2026, 1, 5), iso(2026, 3, 1));

    const warning = await checkRotation({
      cropName: 'コマツナ',
      placeId: 'place-1',
      plantedOn: THIS_SPRING,
    });

    expect(warning?.rotationYears).toBe(1);
    expect(warning?.history[0]).toMatchObject({ cropName: 'カブ', yearsAgo: 0 });
  });

  it('連作OK（rotationYears 0）の作物は警告しない — タマネギの跡のニンニク', async () => {
    seedPlanting(
      'p-tamanegi',
      'crop-tamanegi',
      'タマネギ',
      'place-1',
      iso(2025, 11, 1),
      iso(2026, 3, 1),
    );

    expect(
      await checkRotation({ cropName: 'ニンニク', placeId: 'place-1', plantedOn: THIS_SPRING }),
    ).toBeNull();
  });

  it('場所が未設定なら判定しない', async () => {
    seedPlanting('p-nasu', 'crop-nasu', 'ナス', 'place-1', iso(2025, 5, 1), iso(2025, 10, 1));

    expect(
      await checkRotation({ cropName: 'トマト', placeId: null, plantedOn: THIS_SPRING }),
    ).toBeNull();
  });

  it('マスターに無い作物は判定しない', async () => {
    seedPlanting('p-nasu', 'crop-nasu', 'ナス', 'place-1', iso(2025, 5, 1), iso(2025, 10, 1));

    expect(
      await checkRotation({
        cropName: 'アーティチョーク',
        placeId: 'place-1',
        plantedOn: THIS_SPRING,
      }),
    ).toBeNull();
  });

  it('cropId が付いていない自由入力の履歴は科が分からないので数えない', async () => {
    seedPlanting('p-free', null, 'ナス', 'place-1', iso(2025, 5, 1), iso(2025, 10, 1));

    expect(
      await checkRotation({ cropName: 'トマト', placeId: 'place-1', plantedOn: THIS_SPRING }),
    ).toBeNull();
  });

  it('育成中の株は何年前に植えたかによらず「いま」として警告する', async () => {
    seedPlanting('p-jaga', 'crop-jagaimo', 'ジャガイモ', 'place-1', iso(2022, 3, 1), null);

    const warning = await checkRotation({
      cropName: 'ナス',
      placeId: 'place-1',
      plantedOn: THIS_SPRING,
    });

    expect(warning?.history[0]).toMatchObject({ growing: true, yearsAgo: 0 });
    expect(rotationTimingLabel(warning?.history[0] ?? never())).toBe('いま');
  });

  it('編集中の栽培は自分自身を履歴から外す', async () => {
    seedPlanting('p-me', 'crop-tomato', 'トマト', 'place-1', THIS_SPRING, null);

    expect(
      await checkRotation({
        cropName: 'トマト',
        placeId: 'place-1',
        plantedOn: THIS_SPRING,
        excludePlantingId: 'p-me',
      }),
    ).toBeNull();
    // 除外しなければ自分が履歴として出てしまう（渡し忘れの検知）
    expect(
      await checkRotation({ cropName: 'トマト', placeId: 'place-1', plantedOn: THIS_SPRING }),
    ).not.toBeNull();
  });

  it('履歴は育成中→新しい順に並び、3件で打ち切る', async () => {
    seedPlanting('p1', 'crop-nasu', 'ナス', 'place-1', iso(2023, 5, 1), iso(2023, 10, 1));
    seedPlanting('p2', 'crop-piiman', 'ピーマン', 'place-1', iso(2024, 5, 1), iso(2024, 10, 1));
    seedPlanting('p3', 'crop-jagaimo', 'ジャガイモ', 'place-1', iso(2025, 3, 1), iso(2025, 6, 1));
    seedPlanting('p4', 'crop-togarashi', 'トウガラシ', 'place-1', iso(2024, 6, 1), null);

    const warning = await checkRotation({
      cropName: 'トマト',
      placeId: 'place-1',
      plantedOn: THIS_SPRING,
    });

    expect(warning?.history.map((entry) => entry.cropName)).toEqual([
      'トウガラシ',
      'ジャガイモ',
      'ピーマン',
    ]);
  });

  it('別名で入力してもマスターへ寄せて判定する（ミニトマト → トマト）', async () => {
    seedPlanting('p-nasu', 'crop-nasu', 'ナス', 'place-1', iso(2025, 5, 1), iso(2025, 10, 1));

    const warning = await checkRotation({
      cropName: 'ミニトマト',
      placeId: 'place-1',
      plantedOn: THIS_SPRING,
    });

    // 表示は利用者が書いた名前のまま。マスター名に書き換えると別の作物を勧めたように見える
    expect(warning?.cropName).toBe('ミニトマト');
    expect(warning?.family).toBe('ナス科');
  });
});

/** 取れなかったら落とす。`?.` の連鎖で undefined が黙って流れるのを防ぐ */
function never(): never {
  throw new Error('履歴が取れていません');
}

describe('yearsBetween', () => {
  it('暦年の差で数える（11か月前でも年が違えば1年前）', () => {
    expect(yearsBetween(iso(2025, 5, 1), iso(2026, 4, 1))).toBe(1);
    expect(yearsBetween(iso(2026, 1, 5), iso(2026, 12, 20))).toBe(0);
    expect(yearsBetween(iso(2022, 8, 1), iso(2026, 4, 1))).toBe(4);
  });

  it('さかのぼって登録して基準日より前になっても負にしない', () => {
    expect(yearsBetween(iso(2026, 10, 1), iso(2024, 4, 1))).toBe(0);
  });
});

describe('describeRotationWarning', () => {
  const base = {
    cropName: 'トマト',
    family: 'ナス科',
    rotationYears: 4,
    placeName: '南の畝',
  };

  it('終わった株は「育てました」で書く', () => {
    expect(
      describeRotationWarning({
        ...base,
        history: [
          {
            plantingId: 'p1',
            cropName: 'ナス',
            plantedOn: iso(2025, 5, 1),
            endedAt: iso(2025, 10, 1),
            growing: false,
            yearsAgo: 1,
          },
        ],
      }),
    ).toBe('南の畝では去年ナス（ナス科）を育てました。トマトは4年あけるのが目安です。');
  });

  it('育成中の株は「いま」「育てています」で書く', () => {
    expect(
      describeRotationWarning({
        ...base,
        history: [
          {
            plantingId: 'p1',
            cropName: 'ピーマン',
            plantedOn: iso(2025, 5, 1),
            endedAt: null,
            growing: true,
            yearsAgo: 0,
          },
        ],
      }),
    ).toBe('南の畝ではいまピーマン（ナス科）を育てています。トマトは4年あけるのが目安です。');
  });
});

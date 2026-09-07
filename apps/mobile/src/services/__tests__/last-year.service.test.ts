/**
 * 「去年の今ごろ」を実 SQLite に対してテストする（R27 / WBS 4.9）。
 *
 * 見るのは 3 つ。**窓の作り方**（月日で合わせる・閏年）、**何を見出しに選ぶか**、
 * そして **初年度に何が出るか**（この機能の一番の設計判断）。
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

jest.mock('../photo-storage.service', () => ({
  MAX_GARDEN_PHOTOS: 6,
  deleteGardenPhotoFiles: () => Promise.resolve(),
}));

import { createCareLog } from '../care-log.service';
import { createHarvest } from '../harvest.service';
import { createPlanting } from '../planting.service';
import {
  describeLastYear,
  getLastYearCard,
  LAST_YEAR_MAX_PHOTOS,
  PROMISE_MIN_ENTRIES,
  recordPath,
  seasonWindow,
} from '../last-year.service';

const FAMILY_ID = 'family-001';

/** 基準日を固定する。実行日に縛られると「去年」が毎日ずれる */
const NOW = new Date(2026, 8, 7, 12, 0, 0); // 2026-09-07

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

/** 端末ローカルの正午。日付境界のブレを避ける */
function noon(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

describe('seasonWindow', () => {
  it('去年の同じ月日を中心に、前後 2 週間の窓を作る', () => {
    const window = seasonWindow(NOW, 1);
    expect(window.anchor.getFullYear()).toBe(2025);
    expect(window.anchor.getMonth()).toBe(8); // 9 月
    expect(window.anchor.getDate()).toBe(7);
    expect(window.from).toBe(new Date(2025, 7, 24, 0, 0, 0, 0).toISOString());
    expect(window.to).toBe(new Date(2025, 8, 21, 23, 59, 59, 999).toISOString());
  });

  // -365 日で引くと閏年をまたぐたび 1 日ずれ、4 年で 1 日積み上がる。
  // 菜園は季節の営みなので月日で合わせる
  it('閏年をまたいでも月日がずれない', () => {
    const window = seasonWindow(new Date(2029, 2, 1, 12, 0, 0), 1); // 2029-03-01
    expect(window.anchor.getMonth()).toBe(2);
    expect(window.anchor.getDate()).toBe(1);
  });

  // new Date(2027, 1, 29) は 3 月 1 日へ繰り上がる。そのままだと
  // 「去年の 3 月 1 日」と出て、季節がひと月ぶんずれて見える
  it('2 月 29 日は前年の 2 月 28 日へ寄せる（3 月へ繰り上げない）', () => {
    const window = seasonWindow(new Date(2028, 1, 29, 12, 0, 0), 1); // 2028-02-29
    expect(window.anchor.getFullYear()).toBe(2027);
    expect(window.anchor.getMonth()).toBe(1);
    expect(window.anchor.getDate()).toBe(28);
  });

  it('yearsAgo=0 なら今年の同じ時期', () => {
    expect(seasonWindow(NOW, 0).anchor.getFullYear()).toBe(2026);
  });
});

describe('describeLastYear', () => {
  const base = {
    entryId: 'e1',
    plantingId: 'p1',
    cropName: 'キュウリ',
    date: '2025-09-07',
  };

  it('収穫は「収穫していました」', () => {
    expect(describeLastYear({ ...base, type: 'harvest', kind: null })).toBe(
      '去年の9月7日、キュウリを収穫していました',
    );
  });

  it('作業は種別を入れる', () => {
    expect(describeLastYear({ ...base, type: 'care_log', kind: 'water' })).toBe(
      '去年の9月7日、キュウリの水やりをしていました',
    );
  });

  // 「その他をしていました」は日本語にならない
  it('その他は「記録をつけていました」に逃がす', () => {
    expect(describeLastYear({ ...base, type: 'care_log', kind: 'other' })).toBe(
      '去年の9月7日、キュウリの記録をつけていました',
    );
  });
});

describe('recordPath', () => {
  it('収穫と作業で遷移先を分ける（ホームのタイムラインと同じ規則）', () => {
    expect(recordPath({ plantingId: 'p1', entryId: 'h1', type: 'harvest' })).toBe(
      '/plantings/p1/harvests/h1',
    );
    expect(recordPath({ plantingId: 'p1', entryId: 'c1', type: 'care_log' })).toBe(
      '/plantings/p1/care-logs/c1',
    );
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('getLastYearCard (real SQLite)', () => {
  let cucumber: string;
  let tomato: string;

  beforeEach(async () => {
    mockHandles = createTestDb();
    seedFamily();
    cucumber = await createPlanting({
      cropName: 'キュウリ',
      plantedOn: noon(2025, 5, 10),
      plantedAs: 'seedling',
      tags: [],
    });
    tomato = await createPlanting({
      cropName: 'トマト',
      plantedOn: noon(2025, 5, 10),
      plantedAs: 'seedling',
      tags: [],
    });
  });

  afterEach(() => mockHandles.close());

  describe('去年の記録があるとき', () => {
    it('窓に入った記録から見出しを作る', async () => {
      await createHarvest({
        plantingId: cucumber,
        harvestedAt: noon(2025, 9, 7),
        quantity: 3,
        unit: 'piece',
      });

      const card = await getLastYearCard(NOW);
      expect(card.state).toBe('last_year');
      if (card.state !== 'last_year') return;
      expect(card.highlight.cropName).toBe('キュウリ');
      expect(card.highlight.date).toBe('2025-09-07');
      expect(describeLastYear(card.highlight)).toBe('去年の9月7日、キュウリを収穫していました');
    });

    it('窓の外（去年の 7 月）は入れない', async () => {
      await createCareLog({
        plantingId: cucumber,
        kind: 'water',
        loggedAt: noon(2025, 7, 1),
      });

      expect((await getLastYearCard(NOW)).state).toBe('none');
    });

    // カードは写真を主役にすると決めているので、見出しと 1 枚目が
    // 同じ記録を指していないと文と絵が食い違う
    it('写真のある記録を見出しに選ぶ（日付が中心から遠くても）', async () => {
      await createCareLog({
        plantingId: tomato,
        kind: 'water',
        loggedAt: noon(2025, 9, 7), // 中心そのもの。ただし写真なし
      });
      await createHarvest({
        plantingId: cucumber,
        harvestedAt: noon(2025, 8, 26), // 中心から 12 日。写真あり
        quantity: 3,
        unit: 'piece',
        photoUris: ['/cucumber.jpg'],
      });

      const card = await getLastYearCard(NOW);
      if (card.state !== 'last_year') throw new Error('last_year を期待');
      expect(card.highlight.cropName).toBe('キュウリ');
      expect(card.photos[0].uri).toContain('cucumber.jpg');
      expect(card.photos[0].entryId).toBe(card.highlight.entryId);
    });

    it('写真が無い年でもカードは出す（見出しだけ）', async () => {
      await createCareLog({
        plantingId: tomato,
        kind: 'fertilize',
        loggedAt: noon(2025, 9, 5),
      });

      const card = await getLastYearCard(NOW);
      if (card.state !== 'last_year') throw new Error('last_year を期待');
      expect(card.photos).toEqual([]);
      expect(card.entryCount).toBe(1);
    });

    it('写真は 1 行に収まる枚数で打ち切る', async () => {
      for (let day = 1; day <= 4; day++) {
        await createCareLog({
          plantingId: tomato,
          kind: 'water',
          loggedAt: noon(2025, 9, day),
          photoUris: ['/a' + day + '.jpg', '/b' + day + '.jpg'],
        });
      }

      const card = await getLastYearCard(NOW);
      if (card.state !== 'last_year') throw new Error('last_year を期待');
      expect(card.photos).toHaveLength(LAST_YEAR_MAX_PHOTOS);
      expect(card.entryCount).toBe(4);
    });

    it('同じ日なら収穫を見出しにする（まとめて記録した日は収穫が見たい）', async () => {
      await createCareLog({
        plantingId: tomato,
        kind: 'water',
        loggedAt: noon(2025, 9, 7),
      });
      await createHarvest({
        plantingId: cucumber,
        harvestedAt: noon(2025, 9, 7),
        quantity: 2,
        unit: 'piece',
      });

      const card = await getLastYearCard(NOW);
      if (card.state !== 'last_year') throw new Error('last_year を期待');
      expect(card.highlight.type).toBe('harvest');
    });
  });

  describe('初年度（去年の記録が無いとき）', () => {
    async function seedThisYear(count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        await createCareLog({
          plantingId: tomato,
          kind: 'water',
          loggedAt: noon(2026, 9, 1 + i),
        });
      }
    }

    // 「まだ記録がありません」を毎日出すのは場所を取るだけ。
    // ホームは既に縦に長い（index.tsx 冒頭の doc コメント）
    it('今年の記録も少なければ、カードごと出さない', async () => {
      await seedThisYear(PROMISE_MIN_ENTRIES - 1);
      expect((await getLastYearCard(NOW)).state).toBe('none');
    });

    it('何も記録が無ければ、当然カードごと出さない', async () => {
      expect((await getLastYearCard(NOW)).state).toBe('none');
    });

    // 記録している人には「その記録は来年に効く」と返す。これが R27 の空状態
    it('今年この時期に記録が貯まっていれば「来年の今ごろ」を出す', async () => {
      await seedThisYear(PROMISE_MIN_ENTRIES);

      const card = await getLastYearCard(NOW);
      expect(card.state).toBe('this_year');
      if (card.state !== 'this_year') return;
      expect(card.entryCount).toBe(PROMISE_MIN_ENTRIES);
    });

    it('今年でも窓の外の記録は数えない', async () => {
      for (let i = 0; i < PROMISE_MIN_ENTRIES; i++) {
        await createCareLog({
          plantingId: tomato,
          kind: 'water',
          loggedAt: noon(2026, 6, 1 + i),
        });
      }

      expect((await getLastYearCard(NOW)).state).toBe('none');
    });
  });
});

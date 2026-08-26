/**
 * 進行帯（ホームの「育てているもの」）を実 SQLite に対してテストする。
 *
 * 利用者目線レビュー（2026-08-26）で決めた状態遷移を固定する:
 * - 収穫の記録があれば **harvesting** — 目安超過を咎めない（next-action と同じ判断）
 * - 未収穫で目安超過なら **due**（採りどきの確認を促す）
 * - マスターに無い自由入力は **none**（帯を描かない）
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
import {
  describeProgress,
  getPlantingProgress,
  type PlantingProgress,
} from '../growth-progress.service';
import { createHarvest } from '../harvest.service';
import { createPlanting, getPlantingList } from '../planting.service';

const FAMILY_ID = 'family-001';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function dateDaysAgo(days: number): string {
  return isoDaysAgo(days).slice(0, 10);
}

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

/** 目安 60 日のマスター作物 */
function seedCrop(id = 'crop-tomato'): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO crops (id, name, name_reading, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, 'トマト', 'とまと', now, now],
  );
  mockHandles.expoDb.runSync(
    `INSERT INTO crop_guides (crop_id, spacing_cm, sunlight, watering_note, fertilize_after_days, harvest_after_days, common_pests, tips)
     VALUES (?, 40, 'full', '毎日', 20, 60, 'アブラムシ', '-')`,
    [id],
  );
}

async function seedPlanting(options: { cropId?: string | null; daysAgo: number }): Promise<string> {
  return createPlanting({
    cropId: options.cropId ?? undefined,
    cropName: 'トマト',
    plantedOn: dateDaysAgo(options.daysAgo),
    plantedAs: 'seedling',
    tags: [],
  });
}

async function progressFor(plantingId: string): Promise<PlantingProgress> {
  const list = await getPlantingList();
  const map = await getPlantingProgress(list);
  const progress = map.get(plantingId);
  if (!progress) throw new Error('progress が返らなかった');
  return progress;
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('growth-progress.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
    seedCrop();
  });

  afterEach(() => {
    mockHandles.close();
  });

  it('目安に向かって育っている間は growing（あと N 日）', async () => {
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 45 });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('growing');
    expect(progress.daysToHarvest).toBe(15);
    expect(progress.ratio).toBeCloseTo(45 / 60, 5);
    expect(describeProgress(progress)).toBe('あと15日');
  });

  it('未収穫で目安を過ぎたら due（採りどき）', async () => {
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('due');
    expect(progress.ratio).toBe(1);
    expect(describeProgress(progress)).toBe('採りどき');
  });

  it('収穫の記録があれば harvesting — 目安超過を咎めない（next-action と同じ判断）', async () => {
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });
    await createHarvest({ plantingId, harvestedAt: isoDaysAgo(3) });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('harvesting');
    expect(progress.harvestCount).toBe(1);
    // 帯は必ず満杯で全栽培が同じ見た目になるので、回数を文字で出して差を作る
    expect(describeProgress(progress)).toBe('1回 採れた');
  });

  it('収穫を重ねたら回数が増える', async () => {
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });
    await createHarvest({ plantingId, harvestedAt: isoDaysAgo(5) });
    await createHarvest({ plantingId, harvestedAt: isoDaysAgo(3) });
    await createHarvest({ plantingId, harvestedAt: isoDaysAgo(1) });

    const progress = await progressFor(plantingId);

    expect(describeProgress(progress)).toBe('3回 採れた');
  });

  it('マスターに無い自由入力は none（帯を描かず日数だけ）', async () => {
    // cropId を渡さなくても、createPlanting が**作物名でマスターへ引き直す**
    // （crop-match.service）。none を再現するにはマスターに無い名前が要る
    const plantingId = await createPlanting({
      cropName: 'パクチー',
      plantedOn: dateDaysAgo(30),
      plantedAs: 'seed',
      tags: [],
    });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('none');
    expect(progress.ratio).toBeNull();
    expect(describeProgress(progress)).toBe('30日目');
  });

  it('cropId を渡さなくても作物名でマスターに紐づく（手入力の取りこぼしを塞ぐ）', async () => {
    // 実機で「アオジソ」「エダマメ」が cropId 無しになり、
    // 帯も「つぎの作業」も出なかった問題への回帰テスト
    const plantingId = await createPlanting({
      cropName: 'トマト',
      plantedOn: dateDaysAgo(45),
      plantedAs: 'seedling',
      tags: [],
    });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('growing');
    expect(describeProgress(progress)).toBe('あと15日');
  });

  it('作業ログはドットになり、同じ日の複数回は 1 つに畳む', async () => {
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 45 });
    await createCareLog({ plantingId, kind: 'water', loggedAt: isoDaysAgo(40) });
    await createCareLog({ plantingId, kind: 'fertilize', loggedAt: isoDaysAgo(40) });
    await createCareLog({ plantingId, kind: 'water', loggedAt: isoDaysAgo(10) });

    const progress = await progressFor(plantingId);

    expect(progress.logDays).toEqual([5, 35]);
  });
});

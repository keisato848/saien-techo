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
  describeProgressForA11y,
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

  it('収穫の幅があれば「あと N 日」は幅の最小まで、帯の右端は最大（4.19）', async () => {
    mockHandles.expoDb.runSync(
      "UPDATE crop_guides SET harvest_window_min_days = 50, harvest_window_max_days = 70 WHERE crop_id = 'crop-tomato'",
    );
    const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 45 });

    const progress = await progressFor(plantingId);

    expect(progress.state).toBe('growing');
    expect(progress.harvestWindow).toEqual({ min: 50, max: 70 });
    expect(progress.harvestAfterDays).toBe(70);
    expect(progress.daysToHarvest).toBe(5);
    expect(progress.ratio).toBeCloseTo(45 / 70, 5);
    expect(describeProgress(progress)).toBe('あと5日');

    // 幅に入ったら due（右端の 70 日を待たない）
    const inWindow = await progressFor(await seedPlanting({ cropId: 'crop-tomato', daysAgo: 55 }));
    expect(inWindow.state).toBe('due');
    expect(inWindow.ratio).toBeCloseTo(55 / 70, 5);
  });

  it('幅が片方だけ・逆転している行は 1 点扱い（旧データの防御）', async () => {
    mockHandles.expoDb.runSync(
      "UPDATE crop_guides SET harvest_window_min_days = 70, harvest_window_max_days = 50 WHERE crop_id = 'crop-tomato'",
    );
    const progress = await progressFor(await seedPlanting({ cropId: 'crop-tomato', daysAgo: 45 }));
    expect(progress.harvestWindow).toBeNull();
    expect(progress.daysToHarvest).toBe(15);
  });

  // 幅の最大も過ぎたのに due のままだと「採りどき」が終わらず、
  // ダイコンの 60 日目も 120 日目も同じ表示になっていた（4.19 レビュー 10）
  it('幅の最大も過ぎて未収穫なら over（終わりごろ）', async () => {
    mockHandles.expoDb.runSync(
      "UPDATE crop_guides SET harvest_window_min_days = 50, harvest_window_max_days = 70 WHERE crop_id = 'crop-tomato'",
    );

    const inWindow = await progressFor(await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 }));
    expect(inWindow.state).toBe('due');
    expect(describeProgress(inWindow)).toBe('採りどき');

    const over = await progressFor(await seedPlanting({ cropId: 'crop-tomato', daysAgo: 71 }));
    expect(over.state).toBe('over');
    expect(over.ratio).toBe(1);
    // 咎めない。「過ぎています」は出さない
    expect(describeProgress(over)).toBe('終わりごろ');
  });

  it('幅を持たない旧データは過ぎても due のまま（over にしない）', async () => {
    const progress = await progressFor(await seedPlanting({ cropId: 'crop-tomato', daysAgo: 200 }));
    expect(progress.state).toBe('due');
  });

  // 28 品目で「満杯固定の期間 ÷ 在圃期間」が平均 37%（バジル 69% / シソ 64%）あり、
  // その間ずっと帯が右端に貼りついて動かなかった（4.19 レビュー 16）
  describe('収穫中の帯（採り入れ期間の軸）', () => {
    beforeEach(() => {
      mockHandles.expoDb.runSync(
        "UPDATE crop_guides SET harvest_duration_days = 40 WHERE crop_id = 'crop-tomato'",
      );
    });

    it('初収穫からの残りで帯が動く', async () => {
      const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });
      await createHarvest({ plantingId, harvestedAt: isoDaysAgo(10) }); // 60 日目に初収穫

      const progress = await progressFor(plantingId);

      expect(progress.state).toBe('harvesting');
      expect(progress.bandStartDay).toBe(60);
      expect(progress.bandEndDay).toBe(100);
      expect(progress.ratio).toBeCloseTo(10 / 40, 5);
      expect(progress.daysLeftInHarvest).toBe(30);
      expect(describeProgress(progress)).toBe('あと30日 採れる');
    });

    it('いちばん古い収穫が左端になる（あとから古い日付を足しても動く）', async () => {
      const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });
      await createHarvest({ plantingId, harvestedAt: isoDaysAgo(5) });
      await createHarvest({ plantingId, harvestedAt: isoDaysAgo(20) });

      const progress = await progressFor(plantingId);

      expect(progress.bandStartDay).toBe(50);
      expect(progress.bandEndDay).toBe(90);
    });

    it('採り入れ期間を過ぎたら満杯に戻り、回数の表示に戻る', async () => {
      const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 130 });
      await createHarvest({ plantingId, harvestedAt: isoDaysAgo(70) }); // 60 日目に初収穫

      const progress = await progressFor(plantingId);

      expect(progress.ratio).toBe(1);
      expect(progress.daysLeftInHarvest).toBeNull();
      expect(describeProgress(progress)).toBe('1回 採れた');
    });

    it('採り入れ期間を持たない作物は今までどおり満杯・回数のまま', async () => {
      mockHandles.expoDb.runSync(
        "UPDATE crop_guides SET harvest_duration_days = NULL WHERE crop_id = 'crop-tomato'",
      );
      const plantingId = await seedPlanting({ cropId: 'crop-tomato', daysAgo: 70 });
      await createHarvest({ plantingId, harvestedAt: isoDaysAgo(10) });

      const progress = await progressFor(plantingId);

      expect(progress.bandStartDay).toBe(0);
      expect(progress.bandEndDay).toBe(60);
      expect(progress.ratio).toBe(1);
      expect(describeProgress(progress)).toBe('1回 採れた');
    });
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

/**
 * 読み上げの文言（レビュー 36）。進行帯は Svg で中身を読み上げに出さないので、
 * 帯が目で示していること（今日の位置・収穫の窓・作業ログ）が
 * ここに言葉として出ていないと、読み上げ利用者には帯が存在しない。
 */
describe('describeProgressForA11y', () => {
  const base: PlantingProgress = {
    plantingId: 'planting-1',
    state: 'growing',
    harvestCount: 0,
    elapsedDays: 45,
    harvestAfterDays: 70,
    harvestWindow: { min: 60, max: 70 },
    ratio: 45 / 70,
    daysToHarvest: 15,
    logDays: [5, 20, 35],
  };

  it('76px の短文とは別物で、経過日数・収穫の窓・作業ログを言葉にする', () => {
    const label = describeProgressForA11y(base);

    expect(label).toBe(
      '植え付けから45日目。収穫の目安まであと15日。収穫の目安は植え付けから60日〜70日。作業の記録3件',
    );
    // 幅 6 文字の describeProgress をそのまま流用していないこと
    expect(label).not.toBe(describeProgress(base));
  });

  it('収穫の幅を持たない作物は 1 点の目安として読む', () => {
    const label = describeProgressForA11y({
      ...base,
      harvestWindow: null,
      harvestAfterDays: 60,
      daysToHarvest: 15,
      logDays: [],
    });

    expect(label).toBe('植え付けから45日目。収穫の目安まであと15日。収穫の目安は植え付けから60日');
  });

  it('採りどきは超過日数まで読む（当日は「今日が収穫の目安」）', () => {
    expect(
      describeProgressForA11y({ ...base, state: 'due', daysToHarvest: -8, logDays: [] }),
    ).toContain('収穫の目安を8日過ぎています。採りどき');
    expect(
      describeProgressForA11y({ ...base, state: 'due', daysToHarvest: 0, logDays: [] }),
    ).toContain('今日が収穫の目安。採りどき');
  });

  it('収穫中は回数を読む（帯が満杯で見た目の差が消えるため）', () => {
    expect(
      describeProgressForA11y({ ...base, state: 'harvesting', harvestCount: 4, logDays: [] }),
    ).toBe('植え付けから45日目。これまでに4回 収穫しました。収穫の目安は植え付けから60日〜70日');
  });

  it('目安が無い作物は日数だけを読む', () => {
    expect(
      describeProgressForA11y({
        ...base,
        state: 'none',
        harvestAfterDays: null,
        harvestWindow: null,
        ratio: null,
        daysToHarvest: null,
        logDays: [],
      }),
    ).toBe('植え付けから45日目。収穫の目安は分かりません');
  });
});

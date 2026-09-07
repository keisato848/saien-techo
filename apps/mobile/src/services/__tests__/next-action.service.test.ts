/**
 * 「次の作業」を実 SQLite に対してテストする（R10 / WBS 3.4）。
 * ガイドの日数はマスターそのもの（カブ: 追肥 20 日・収穫 45 日、幅 40〜60 日・間引き 10 日と 20 日）。
 * 4.19 で「収穫は幅の最小から」「作業（間引きなど）は目安日から 2 週間だけ」「2 回目以降の追肥は間隔で」になった。
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
  careLogKindForAction,
  describeNextAction,
  getNextActions,
  getNextActionsForPlanting,
  nextActionLabel,
  snoozeNextAction,
  type NextAction,
} from '../next-action.service';

const FAMILY_ID = 'family-001';
const NOW = new Date(2026, 7, 8, 12); // 2026-08-08

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

/** daysAgo 日前に植えた栽培を作る */
function seedPlanting(id: string, cropId: string | null, cropName: string, daysAgo: number): void {
  const planted = new Date(NOW);
  planted.setDate(planted.getDate() - daysAgo);
  mockHandles.expoDb.runSync(
    'INSERT INTO plantings (id, family_id, crop_id, crop_name, planted_on, planted_as, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      FAMILY_ID,
      cropId,
      cropName,
      planted.toISOString(),
      'seed',
      NOW.toISOString(),
      NOW.toISOString(),
    ],
  );
}

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('next-action.service (real SQLite)', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  it('目安を過ぎたら追肥と収穫を提案する（カブ 50 日目 → 両方。収穫は幅の最小 40 日が閾値）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);

    const actions = await getNextActions(NOW);

    expect(actions).toEqual([
      expect.objectContaining({
        plantingId: 'p1',
        kind: 'harvest',
        elapsedDays: 50,
        thresholdDays: 40,
      }),
      expect.objectContaining({
        plantingId: 'p1',
        kind: 'fertilize',
        elapsedDays: 50,
        thresholdDays: 20,
      }),
    ]);
  });

  it('目安前は追肥・収穫を出さない（カブ 10 日目。出るのは 10 日目の間引きだけ）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 10);
    const actions = await getNextActions(NOW);
    expect(actions.map((a) => a.kind)).toEqual(['thin']);
    expect(actions[0]).toEqual(
      expect.objectContaining({ thresholdDays: 10, note: '本葉 1〜2 枚で' }),
    );
  });

  it('追肥済みなら初回の追肥は出さない（カブは追肥間隔を持たないので 2 回目も出ない）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 30);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'fertilize', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    // 30 日目は 20 日目の間引きが猶予（2 週間）の中なので、それだけが残る
    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['thin']);
  });

  it('追肥間隔を持つ作物は、前回の追肥から間隔ぶん経ったら 2 回目を出す（トマト 20 日おき）', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 45);
    const fertilizedAt = new Date(NOW);
    fertilizedAt.setDate(fertilizedAt.getDate() - 25); // 20 日目に追肥
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'fertilize', fertilizedAt.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    const fertilize = (await getNextActions(NOW)).find((a) => a.kind === 'fertilize');
    expect(fertilize).toEqual(
      expect.objectContaining({ thresholdDays: 20, sinceLastDays: 25, elapsedDays: 45 }),
    );
    expect(describeNextAction(fertilize as NextAction)).toBe(
      'そろそろ追肥（前回から25日・目安 20日おき）',
    );
  });

  it('2 回目の追肥は間隔に満たなければ出ない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 30);
    const fertilizedAt = new Date(NOW);
    fertilizedAt.setDate(fertilizedAt.getDate() - 10);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'fertilize', fertilizedAt.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(false);
  });

  it('シーズンの終わり（収穫の目安 + 採れる期間）を過ぎたら 2 回目の追肥は出さない', async () => {
    // トマト: 収穫 60 日 + 採れる期間 90 日 = 150 日。160 日目
    seedPlanting('p1', 'crop-tomato', 'トマト', 160);
    const fertilizedAt = new Date(NOW);
    fertilizedAt.setDate(fertilizedAt.getDate() - 60);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'fertilize', fertilizedAt.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );
    mockHandles.expoDb.runSync(
      'INSERT INTO harvests (id, planting_id, harvested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['h1', 'p1', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(false);
  });

  it('作業は目安日から 2 週間だけ出し、作業ログ（剪定/その他）があれば済みとみなす', async () => {
    // トマト: 支柱 1 日・芽かき 10 日・摘芯 60 日
    seedPlanting('p1', 'crop-tomato', 'トマト', 12);
    const before = await getNextActions(NOW);
    // 支柱（1 日）は猶予切れではない（1+14=15 ≥ 12）、芽かき（10 日）も範囲内
    expect(before.map((a) => a.kind).sort()).toEqual(['stake', 'sucker']);

    // 芽かきは「剪定」の作業ログで済みになる。支柱は「その他」
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'p1', 'prune', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );
    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['stake']);

    // 猶予を過ぎたら消える（30 日目: 支柱 1+14 < 30、芽かき 10+14 < 30）
    const later = new Date(NOW);
    later.setDate(later.getDate() + 18);
    const kinds = (await getNextActions(later)).map((a) => a.kind);
    expect(kinds.filter((kind) => kind !== 'fertilize')).toEqual([]);
  });

  it('同じ作業が 2 回ある作物は目安日ごとに別の提案（ジャガイモの土寄せ 35 日と 55 日）', async () => {
    seedPlanting('p1', 'crop-jagaimo', 'ジャガイモ', 57);
    const actions = await getNextActions(NOW);
    const hills = actions.filter((a) => a.kind === 'hill');
    expect(hills.map((a) => a.thresholdDays)).toEqual([55]);

    // 55 日の土寄せだけ先送りしても、鍵が別なので他の提案は残る
    await snoozeNextAction('p1', 'hill', 55, NOW);
    expect((await getNextActions(NOW)).some((a) => a.kind === 'hill')).toBe(false);
  });

  it('初収穫を記録したら収穫の提案は止まる', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    mockHandles.expoDb.runSync(
      'INSERT INTO harvests (id, planting_id, harvested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['h1', 'p1', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    const actions = await getNextActions(NOW);
    expect(actions.map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('追肥の目安が無い作物（エダマメ）は追肥を提案しない', async () => {
    seedPlanting('p1', 'crop-edamame', 'エダマメ', 30);
    const actions = await getNextActions(NOW);
    expect(actions.some((a) => a.kind === 'fertilize')).toBe(false);
    // 30 日目は 25 日目の土寄せが猶予の中
    expect(actions.map((a) => a.kind)).toEqual(['hill']);
  });

  it('多年草（ニラ）は収穫日数を持たないので収穫を提案しない', async () => {
    seedPlanting('p1', 'crop-nira', 'ニラ', 200);
    const actions = await getNextActions(NOW);
    expect(actions.some((a) => a.kind === 'harvest')).toBe(false);
  });

  it('終了した栽培・ガイド無し栽培は対象外', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    mockHandles.expoDb.runSync("UPDATE plantings SET ended_at = ? WHERE id = 'p1'", [
      NOW.toISOString(),
    ]);
    seedPlanting('p2', null, '謎の野菜', 100);

    expect(await getNextActions(NOW)).toEqual([]);
  });

  it('「あとで」で 3 日間消え、4 日後に戻る', async () => {
    // 35 日目: 追肥（20 日）は出て、間引き（10・20 日）は猶予切れ。4 日後も収穫の幅（40 日）の手前
    seedPlanting('p1', 'crop-kabu', 'カブ', 35);
    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['fertilize']);

    await snoozeNextAction('p1', 'fertilize', undefined, NOW);

    expect(await getNextActions(NOW)).toEqual([]);
    const in2days = new Date(NOW);
    in2days.setDate(in2days.getDate() + 2);
    expect(await getNextActions(in2days)).toEqual([]);

    const in4days = new Date(NOW);
    in4days.setDate(in4days.getDate() + 4);
    expect((await getNextActions(in4days)).map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('先送りは栽培×種類ごと（収穫を先送りしても追肥は残る）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    await snoozeNextAction('p1', 'harvest', undefined, NOW);

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['fertilize']);
  });

  it('収穫が先・経過日数の多い順に並ぶ', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50); // harvest + fertilize
    seedPlanting('p2', 'crop-komatsuna', 'コマツナ', 40); // 収穫35・追肥15 → 両方
    const actions = await getNextActions(NOW);

    expect(actions.map((a) => `${a.plantingId}:${a.kind}`)).toEqual([
      'p1:harvest',
      'p2:harvest',
      'p1:fertilize',
      'p2:fertilize',
    ]);
  });

  it('栽培詳細用はその栽培の分だけ返す', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    seedPlanting('p2', 'crop-komatsuna', 'コマツナ', 40);

    const actions = await getNextActionsForPlanting('p2', NOW);
    expect(actions.every((a) => a.plantingId === 'p2')).toBe(true);
    expect(actions).toHaveLength(2);
  });
});

describe('describeNextAction', () => {
  it('R10 の受け入れ基準の文面', () => {
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'カブ',
        kind: 'fertilize',
        elapsedDays: 21,
        thresholdDays: 20,
      }),
    ).toBe('そろそろ追肥（植え付けから21日・目安 約20日）');
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'カブ',
        kind: 'harvest',
        elapsedDays: 50,
        thresholdDays: 45,
      }),
    ).toBe('収穫適期に入りました（目安 約45日・いま50日目）');
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'トマト',
        kind: 'sucker',
        elapsedDays: 12,
        thresholdDays: 10,
        note: '以後 1 週間おきに脇芽をかく',
      }),
    ).toBe('芽かきの時期です（植え付けから12日・目安 約10日） 以後 1 週間おきに脇芽をかく');
    expect(
      describeNextAction({
        plantingId: 'p1',
        cropName: 'ジャガイモ',
        kind: 'hill',
        elapsedDays: 36,
        thresholdDays: 35,
      }),
    ).toBe('土寄せの時期です（植え付けから36日・目安 約35日）');
  });
});

describe('作業の記録先とラベル', () => {
  it('摘芯・芽かき・摘果は剪定、支柱・土寄せ・間引き・ネットはその他、追肥は追肥', () => {
    expect(careLogKindForAction('pinch')).toBe('prune');
    expect(careLogKindForAction('sucker')).toBe('prune');
    expect(careLogKindForAction('fruit-thin')).toBe('prune');
    expect(careLogKindForAction('stake')).toBe('other');
    expect(careLogKindForAction('hill')).toBe('other');
    expect(careLogKindForAction('thin')).toBe('other');
    expect(careLogKindForAction('net')).toBe('other');
    expect(careLogKindForAction('fertilize')).toBe('fertilize');
  });

  it('ボタンの短い名前', () => {
    expect(nextActionLabel({ kind: 'harvest' })).toBe('収穫');
    expect(nextActionLabel({ kind: 'fertilize' })).toBe('追肥');
    expect(nextActionLabel({ kind: 'hill' })).toBe('土寄せ');
    expect(nextActionLabel({ kind: 'fruit-thin' })).toBe('摘果');
  });
});

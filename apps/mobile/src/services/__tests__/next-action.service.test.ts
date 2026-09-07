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
  nextActionRecordHref,
  nextActionRecordLabel,
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

  it('シーズンの終わり（収穫の幅の最大 + 採れる期間）を過ぎたら 2 回目の追肥は出さない', async () => {
    // トマト: 収穫の幅の最大 70 日 + 採れる期間 90 日 = 160 日。165 日目
    seedPlanting('p1', 'crop-tomato', 'トマト', 165);
    const fertilizedAt = new Date(NOW);
    fertilizedAt.setDate(fertilizedAt.getDate() - 65);
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

describeIfSqlite('作業の済み判定（v16 / 4.19 レビュー 6）', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  /** 作業ログを 1 件入れる。taskKind を渡さなければ手書き（v16 より前）扱い */
  function seedCareLog(kind: string, taskKind: string | null = null): void {
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, task_kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        `c-${kind}-${taskKind ?? 'raw'}`,
        'p1',
        kind,
        taskKind,
        NOW.toISOString(),
        NOW.toISOString(),
        NOW.toISOString(),
      ],
    );
  }

  // ソラマメは間引きと支柱がどちらも 130 日目。kind に潰すとどちらも `other` になり、
  // 片方を記録しただけで**もう片方まで「済み」に化けて消えていた**
  it('同じ日の別の作業を記録しても、もう片方は消えない（ソラマメ 間引き 130 / 支柱 130）', async () => {
    seedPlanting('p1', 'crop-soramame', 'ソラマメ', 132);

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['stake', 'thin', 'fertilize']);

    // 「間引きを記録する」から記録すると task_kind が残る
    seedCareLog('other', 'thin');

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['stake', 'fertilize']);
  });

  it('task_kind を持つログは kind の一致では済みにしない（別の作業まで消えない）', async () => {
    seedPlanting('p1', 'crop-soramame', 'ソラマメ', 132);
    // 防虫ネットを「その他」で記録しても、間引き・支柱は残る
    seedCareLog('other', 'net');

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['stake', 'thin', 'fertilize']);
  });

  it('task_kind が NULL の手書きログは従来どおり kind の一致で済みとみなす', async () => {
    // v16 より前に記録した「その他」。既存データが一斉に「未済」へ戻らないための逃げ道
    seedPlanting('p1', 'crop-soramame', 'ソラマメ', 132);
    seedCareLog('other');

    expect((await getNextActions(NOW)).map((a) => a.kind)).toEqual(['fertilize']);
  });
});

describeIfSqlite('同じ作業が 2 回ある作物（4.19 レビュー 12）', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  // カブは間引きが 10 日と 20 日。20〜24 日目は両方が猶予の中に入る
  it('カブ 22 日目は間引きが 2 件出る（目安日で見分ける）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 22);

    const thins = (await getNextActions(NOW)).filter((a) => a.kind === 'thin');
    expect(thins.map((a) => a.thresholdDays).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('猶予の境目（目安日 + 14 は出る / + 15 は出ない）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 24); // 10 + 14
    expect(
      (await getNextActions(NOW)).some((a) => a.kind === 'thin' && a.thresholdDays === 10),
    ).toBe(true);

    const nextDay = new Date(NOW);
    nextDay.setDate(nextDay.getDate() + 1); // 25 日目 = 10 + 15
    expect(
      (await getNextActions(nextDay)).some((a) => a.kind === 'thin' && a.thresholdDays === 10),
    ).toBe(false);
  });
});

describeIfSqlite('2 回目以降の追肥（4.19 レビュー 4・13）', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  function seedFertilizeLog(daysAgo: number): void {
    const at = new Date(NOW);
    at.setDate(at.getDate() - daysAgo);
    mockHandles.expoDb.runSync(
      'INSERT INTO care_logs (id, planting_id, kind, logged_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [`c-${daysAgo}`, 'p1', 'fertilize', at.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );
  }

  function seedReminder(id: string, kind: string, enabled: number): void {
    mockHandles.expoDb.runSync(
      'INSERT INTO reminders (id, planting_id, kind, schedule_kind, interval_days, hour, minute, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, 'p1', kind, 'interval_days', 20, 8, 0, enabled, NOW.toISOString(), NOW.toISOString()],
    );
  }

  // ハクサイは採れる期間を持たない（一度で採り切る）。以前は seasonEnd が null になり、
  // **いちばん止めたい作物ほど止まらなかった**
  it('採れる期間を持たない作物も、収穫の幅の最大を過ぎたら止まる（ハクサイ 90 日）', async () => {
    // ハクサイ: 追肥 20 日おき・収穫の幅 70〜90 日
    seedPlanting('p1', 'crop-hakusai', 'ハクサイ', 95);
    seedFertilizeLog(40);

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(false);
  });

  it('幅の中ならまだ出す（ハクサイ 85 日目）', async () => {
    seedPlanting('p1', 'crop-hakusai', 'ハクサイ', 85);
    seedFertilizeLog(40);

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(true);
  });

  it('一度で採り切る作物は、初収穫を記録したら追肥を止める', async () => {
    seedPlanting('p1', 'crop-hakusai', 'ハクサイ', 85);
    seedFertilizeLog(40);
    mockHandles.expoDb.runSync(
      'INSERT INTO harvests (id, planting_id, harvested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['h1', 'p1', NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    );

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(false);
  });

  it('猶予（2 週間）を過ぎたらいったん引っ込み、次の間隔でまた出る', async () => {
    // トマト: 20 日おき。前回の追肥から 25 日 → 出る
    seedPlanting('p1', 'crop-tomato', 'トマト', 45);
    seedFertilizeLog(25);
    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(true);

    // 11 日後（前回から 36 日）は 20+14 を過ぎているので引っ込む
    const overdue = new Date(NOW);
    overdue.setDate(overdue.getDate() + 11);
    expect((await getNextActions(overdue)).some((a) => a.kind === 'fertilize')).toBe(false);

    // 15 日後（前回から 40 日 = 間隔 2 回ぶん）でまた出る
    const nextCycle = new Date(NOW);
    nextCycle.setDate(nextCycle.getDate() + 15);
    expect((await getNextActions(nextCycle)).some((a) => a.kind === 'fertilize')).toBe(true);
  });

  // care-schedule.service が追肥のリマインダーを提案するので、この衝突は現実に起きる
  it('追肥のリマインダーがある栽培では 2 回目以降を出さない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 45);
    seedFertilizeLog(25);
    seedReminder('r1', 'fertilize', 1);

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(false);
  });

  it('止めてあるリマインダー・別の種類のリマインダーは邪魔しない', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 45);
    seedFertilizeLog(25);
    seedReminder('r1', 'fertilize', 0);
    seedReminder('r2', 'water', 1);

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(true);
  });

  it('初回の追肥はリマインダーがあっても出す（シーズンで一度きりの別物）', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 25);
    seedReminder('r1', 'fertilize', 1);

    expect((await getNextActions(NOW)).some((a) => a.kind === 'fertilize')).toBe(true);
  });
});

describeIfSqlite('並び（4.19 レビュー 5）', () => {
  beforeEach(async () => {
    mockHandles = createTestDb();
    seedBase();
    await syncCropMaster(mockHandles.db);
  });

  afterEach(() => mockHandles.close());

  // 経過日数の降順だけで並べていた頃は、目安 10 日以内の作業が常に最下位に沈み、
  // カードの表示上限（2 件）に一度も乗らないまま猶予 14 日で消えていた
  it('猶予が先に切れる作業を先に出す（古い栽培の追肥より、若い栽培の防虫ネット）', async () => {
    seedPlanting('p1', 'crop-tomato', 'トマト', 45); // 追肥（初回・20 日）
    seedPlanting('p2', 'crop-hakusai', 'ハクサイ', 3); // 防虫ネット（1 日・残り 12 日）

    const order = (await getNextActions(NOW)).map((a) => `${a.plantingId}:${a.kind}`);
    expect(order.indexOf('p2:net')).toBeLessThan(order.indexOf('p1:fertilize'));
  });

  it('猶予が同じなら、取り返しのつかない作業（支柱）が間引きより先', async () => {
    // ソラマメ: 間引きも支柱も 130 日目
    seedPlanting('p1', 'crop-soramame', 'ソラマメ', 132);

    const kinds = (await getNextActions(NOW)).map((a) => a.kind);
    expect(kinds.indexOf('stake')).toBeLessThan(kinds.indexOf('thin'));
  });

  it('収穫はいちばん先のまま（採り遅れは数日で味が落ちる）', async () => {
    seedPlanting('p1', 'crop-kabu', 'カブ', 50);
    seedPlanting('p2', 'crop-hakusai', 'ハクサイ', 3);

    expect((await getNextActions(NOW))[0].kind).toBe('harvest');
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

  // 幅の最大を持ったのに「適期に入りました」しか言えず、
  // 採りどきが終わっても同じ文が出続けていた（4.19 レビュー 10）
  describe('収穫は幅で 3 通り', () => {
    function harvest(elapsedDays: number, windowMaxDays?: number): NextAction {
      return {
        plantingId: 'p1',
        cropName: 'ダイコン',
        kind: 'harvest',
        elapsedDays,
        thresholdDays: 60,
        ...(windowMaxDays != null ? { windowMaxDays } : {}),
      };
    }

    it('窓の中', () => {
      expect(describeNextAction(harvest(65, 80))).toBe(
        '収穫適期に入りました（目安 60〜80日・いま65日目）',
      );
    });

    it('窓を過ぎたら咎めずに終わりが近いことを言う', () => {
      expect(describeNextAction(harvest(90, 80))).toBe(
        'そろそろ終わり（目安 60〜80日・いま90日目）かたくなる前に',
      );
    });

    it('幅を持たない旧データは今までどおり', () => {
      expect(describeNextAction(harvest(65))).toBe(
        '収穫適期に入りました（目安 約60日・いま65日目）',
      );
    });
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

  // カブの間引きは 10 日と 20 日の 2 回あり、20〜24 日目は両方が猶予の中に入る。
  // 名前だけだとラベルが同一になり、読み上げでも区別できない（4.19 レビュー 12）
  it('読み上げラベルは作業だけ目安日を添えて一意にする', () => {
    expect(nextActionRecordLabel({ kind: 'thin', thresholdDays: 20 })).toBe('間引き（20日目安）');
    expect(nextActionRecordLabel({ kind: 'thin', thresholdDays: 10 })).toBe('間引き（10日目安）');
    // 収穫・追肥は栽培ごとに 1 件しか出ないので添えない
    expect(nextActionRecordLabel({ kind: 'harvest', thresholdDays: 45 })).toBe('収穫');
    expect(nextActionRecordLabel({ kind: 'fertilize', thresholdDays: 20 })).toBe('追肥');
  });

  // kind だけを渡していた頃は、土寄せも間引きも防虫ネットも
  // タイムラインに「その他」としか残らなかった（4.19 レビュー 6）
  it('記録の遷移先は kind に加えて task と note を渡す', () => {
    expect(nextActionRecordHref({ plantingId: 'p1', kind: 'harvest' })).toBe(
      '/plantings/p1/harvests/new',
    );
    expect(nextActionRecordHref({ plantingId: 'p1', kind: 'fertilize' })).toBe(
      '/plantings/p1/care-logs/new?kind=fertilize',
    );
    expect(nextActionRecordHref({ plantingId: 'p1', kind: 'hill' })).toBe(
      '/plantings/p1/care-logs/new?kind=other&task=hill',
    );
    expect(nextActionRecordHref({ plantingId: 'p1', kind: 'sucker', note: '脇芽をかく' })).toBe(
      `/plantings/p1/care-logs/new?kind=prune&task=sucker&note=${encodeURIComponent('脇芽をかく')}`,
    );
  });
});

jest.mock('../../db/client', () => ({ isNativePlatform: true }));
jest.mock('../pantry.service', () => ({ getPantryItems: jest.fn() }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));
jest.mock('../notification.service', () => ({ presentLowStockNotification: jest.fn() }));
// filterLowMaterials は本物を使う（判定そのものは material.service のテストで固定済み）
jest.mock('../material.service', () => ({
  ...jest.requireActual('../material.service'),
  getMaterials: jest.fn(),
}));

import { getAppMeta, setAppMeta } from '../app-meta.service';
import {
  buildLowMaterialBody,
  buildLowStockBody,
  checkAndNotifyLowMaterials,
  checkAndNotifyLowStock,
  filterLowStock,
} from '../low-stock.service';
import { getMaterials } from '../material.service';
import { presentLowStockNotification } from '../notification.service';
import { getPantryItems } from '../pantry.service';
import type { MaterialItem, PantryItem } from '../types';

function item(partial: Partial<PantryItem>): PantryItem {
  return {
    id: 'id',
    name: '卵',
    quantity: null,
    unit: null,
    lowStockThreshold: null,
    janCode: null,
    ...partial,
  };
}

function material(partial: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'id',
    name: '化成肥料',
    category: 'fertilizer',
    quantity: null,
    unit: null,
    lowThreshold: null,
    note: null,
    ...partial,
  };
}

const mockGetPantryItems = getPantryItems as jest.MockedFunction<typeof getPantryItems>;
const mockGetMaterials = getMaterials as jest.MockedFunction<typeof getMaterials>;
const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockPresent = presentLowStockNotification as jest.MockedFunction<
  typeof presentLowStockNotification
>;

/** 端末ローカルの「今日」。サービス側の dayKey と同じ作り方 */
function todayKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
}

describe('filterLowStock', () => {
  it('keeps only items at/below their threshold', () => {
    const items = [
      item({ id: 'a', quantity: 1, lowStockThreshold: 1 }), // at threshold → low
      item({ id: 'b', quantity: 0, lowStockThreshold: 1 }), // below → low
      item({ id: 'c', quantity: 2, lowStockThreshold: 1 }), // above → not
      item({ id: 'd', quantity: null, lowStockThreshold: 1 }), // unmanaged qty → not
      item({ id: 'e', quantity: 0, lowStockThreshold: null }), // no threshold → not
      item({ id: 'f', quantity: 0, lowStockThreshold: 0 }), // 0 ≤ 0 → low
    ];
    expect(filterLowStock(items).map((it) => it.id)).toEqual(['a', 'b', 'f']);
  });
});

describe('buildLowStockBody', () => {
  it('joins names with 、', () => {
    expect(buildLowStockBody(['卵', '牛乳'])).toBe(
      '卵、牛乳 の残りが少なくなっています。買い物リストに追加しましょう。',
    );
  });

  it('truncates beyond 5 names with ほかN件', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(buildLowStockBody(names)).toBe(
      'a、b、c、d、e ほか2件 の残りが少なくなっています。買い物リストに追加しましょう。',
    );
  });
});

describe('checkAndNotifyLowStock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when nothing is low', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 5, lowStockThreshold: 1 })]);
    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('notifies once and records the day', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 1, lowStockThreshold: 1 })]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue('notif-1');

    expect(await checkAndNotifyLowStock()).toBe(true);
    expect(mockPresent).toHaveBeenCalledWith(expect.stringContaining('卵'));
    expect(setAppMeta).toHaveBeenCalledWith(
      'low_stock_notified_day',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('is silent when already notified today', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 0, lowStockThreshold: 1 })]);
    mockGetAppMeta.mockResolvedValue(todayKey());

    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('does not consume the day when the notification is denied', async () => {
    mockGetPantryItems.mockResolvedValue([item({ quantity: 0, lowStockThreshold: 1 })]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue(null);

    expect(await checkAndNotifyLowStock()).toBe(false);
    expect(setAppMeta).not.toHaveBeenCalled();
  });
});

// ─── 資材（R12 / WBS 2.6）────────────────────────────────────────────────────

describe('buildLowMaterialBody', () => {
  it('買い足しを促す文面になる（買い物リストへは誘導しない）', () => {
    expect(buildLowMaterialBody(['化成肥料', '培養土'])).toBe(
      '化成肥料、培養土の残りが少なくなっています。買い足しておきましょう。',
    );
  });

  it('全角の閉じ括弧で終わる名前でも空白を挟まない', () => {
    expect(buildLowMaterialBody(['トマトの種（アイコ）'])).toBe(
      'トマトの種（アイコ）の残りが少なくなっています。買い足しておきましょう。',
    );
  });

  it('6 件以上は ほかN件 にまとめる', () => {
    expect(buildLowMaterialBody(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe(
      'a、b、c、d、e ほか2件の残りが少なくなっています。買い足しておきましょう。',
    );
  });
});

describe('checkAndNotifyLowMaterials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('閾値を割っていなければ鳴らさない', async () => {
    mockGetMaterials.mockResolvedValue([material({ quantity: 5, lowThreshold: 1 })]);

    expect(await checkAndNotifyLowMaterials()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('数量だけあって閾値が無い資材では鳴らさない', async () => {
    mockGetMaterials.mockResolvedValue([material({ quantity: 0, lowThreshold: null })]);

    expect(await checkAndNotifyLowMaterials()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('鳴らしたらその日を記録する', async () => {
    mockGetMaterials.mockResolvedValue([
      material({ name: 'トマトの種', quantity: 1, lowThreshold: 2 }),
    ]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue('notif-1');

    expect(await checkAndNotifyLowMaterials()).toBe(true);
    expect(mockPresent).toHaveBeenCalledWith(
      expect.stringContaining('トマトの種'),
      '資材が少なくなっています',
    );
    expect(setAppMeta).toHaveBeenCalledWith(
      'material_low_notified_day',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('同じ日に 2 回は鳴らさない', async () => {
    mockGetMaterials.mockResolvedValue([material({ quantity: 1, lowThreshold: 2 })]);
    mockGetAppMeta.mockResolvedValue(todayKey());

    expect(await checkAndNotifyLowMaterials()).toBe(false);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('通知が拒否されたらその日を消費しない（許可後に鳴らせる）', async () => {
    mockGetMaterials.mockResolvedValue([material({ quantity: 1, lowThreshold: 2 })]);
    mockGetAppMeta.mockResolvedValue(null);
    mockPresent.mockResolvedValue(null);

    expect(await checkAndNotifyLowMaterials()).toBe(false);
    expect(setAppMeta).not.toHaveBeenCalled();
  });

  it('食材の在庫とは別の日付キーを使う（片方が鳴った日にもう片方が黙らない）', async () => {
    mockGetMaterials.mockResolvedValue([material({ quantity: 1, lowThreshold: 2 })]);
    mockGetAppMeta.mockImplementation(async (key: string) =>
      key === 'low_stock_notified_day' ? todayKey() : null,
    );
    mockPresent.mockResolvedValue('notif-1');

    expect(await checkAndNotifyLowMaterials()).toBe(true);
  });
});

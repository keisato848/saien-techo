jest.mock('../../db/client', () => ({ isNativePlatform: true }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));
jest.mock('../notification.service', () => ({ presentLowStockNotification: jest.fn() }));
// filterLowMaterials は本物を使う（判定そのものは material.service のテストで固定済み）
jest.mock('../material.service', () => ({
  ...jest.requireActual('../material.service'),
  getMaterials: jest.fn(),
}));

import { getAppMeta, setAppMeta } from '../app-meta.service';
import { buildLowMaterialBody, checkAndNotifyLowMaterials } from '../low-stock.service';
import { getMaterials } from '../material.service';
import { presentLowStockNotification } from '../notification.service';
import type { MaterialItem } from '../types';

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

describe('buildLowMaterialBody', () => {
  it('買い足しを促す文面になる', () => {
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
});

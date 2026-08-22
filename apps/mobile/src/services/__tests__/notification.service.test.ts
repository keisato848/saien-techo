jest.mock('../../db/client', () => ({ isNativePlatform: true }));

import * as Notifications from 'expo-notifications';

import { ensureNotificationPermission, presentLowStockNotification } from '../notification.service';

// だいどこの調理タイマー通知は WBS 2.9c で削除した。
// リマインダーの予約・解除は reminder.service.test 側で担保している。

describe('notification.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports permission granted', async () => {
    expect(await ensureNotificationPermission()).toBe(true);
  });

  it('presents an immediate low-stock notification', async () => {
    const id = await presentLowStockNotification('化成肥料の残りが少なくなっています。');
    expect(id).toBe('mock-notification-id');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('uses the given title (資材のお知らせで差し替える)', async () => {
    await presentLowStockNotification('本文', '資材が少なくなっています');
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.title).toBe('資材が少なくなっています');
  });

  it('does not present an empty low-stock body', async () => {
    expect(await presentLowStockNotification('')).toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

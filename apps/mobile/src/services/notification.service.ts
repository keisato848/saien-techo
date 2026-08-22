/**
 * ローカル通知 — 低在庫（資材 R12）とリマインダー（R11）。サーバー・push なし。
 * だいどこの調理タイマー通知は WBS 2.9c で削除した。
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isNativePlatform } from '../db/client';

const LOW_STOCK_CHANNEL_ID = 'low-stock';

let handlerSet = false;
let permissionGranted: boolean | null = null;

function ensureHandler(): void {
  if (handlerSet) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerSet = true;
}

/** Request notification permission (and set up the Android channel). Cached. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform) return false;
  ensureHandler();

  if (permissionGranted === true) return true;
  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  permissionGranted = status === 'granted';
  return permissionGranted;
}

/**
 * Present an immediate local notification for low stock (P3).
 * Returns the notification id, or null if unavailable/denied.
 *
 * `title` は資材（R12 / WBS 2.6）でも使い回すために差し替えられる。
 * 通知チャンネルは共通のまま — 「残量のお知らせ」は利用者から見て 1 種類で、
 * 分けると設定画面のチャンネル一覧が無駄に増える。
 */
export async function presentLowStockNotification(
  body: string,
  title = '在庫がなくなりそうです',
): Promise<string | null> {
  if (!isNativePlatform || !body) return null;
  if (!(await ensureNotificationPermission())) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(LOW_STOCK_CHANNEL_ID, {
      name: '在庫の残量通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: LOW_STOCK_CHANNEL_ID } : null,
    });
  } catch {
    return null;
  }
}

// ─── さいえん手帳のリマインダー（R11 / WBS 2.4）─────────────────────────────

const REMINDER_CHANNEL_ID = 'garden-reminder';

/** 予約通知がさいえん手帳のリマインダーかどうかを data で見分ける */
const REMINDER_MARKER = 'saien-reminder';

/**
 * リマインダー 1 件を予約する。
 *
 * 繰り返しトリガー（DAILY/WEEKLY）ではなく**日時指定で 1 回ずつ**積む。
 * N 日おきに OS の繰り返しトリガーが無く、種類ごとに載せ方を変えると
 * 「毎日だけ動く」ような差が出るため、全部同じ扱いにして
 * 起動時の syncScheduledReminders で積み直す。
 *
 * Doze 下では時刻が数十分ずれうる。水やりの声かけに秒精度は要らないので許容する。
 */
export async function scheduleReminderNotification(
  reminder: { id: string; plantingId: string; kind: string },
  at: Date,
): Promise<boolean> {
  if (!isNativePlatform) return false;
  const granted = await ensureNotificationPermission();
  if (!granted) return false;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: '菜園のリマインダー',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'さいえん手帳',
        body: '今日の作業の時間です',
        data: {
          marker: REMINDER_MARKER,
          reminderId: reminder.id,
          plantingId: reminder.plantingId,
          kind: reminder.kind,
        },
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
    });
    return true;
  } catch {
    // 予約に失敗しても操作は続行させる（次回の同期で積み直る）
    return false;
  }
}

/**
 * さいえん手帳のリマインダーの予約だけ取り消す。
 * タイマーや低在庫の予約まで消さないよう data の marker で選ぶ。
 */
export async function cancelReminderNotifications(): Promise<void> {
  if (!isNativePlatform) return;

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if (item.content?.data?.marker === REMINDER_MARKER) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // 取得できない環境では何もしない
  }
}

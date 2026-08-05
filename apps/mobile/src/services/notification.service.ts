/**
 * Local notifications — used so the cooking timer alerts even when the app is
 * backgrounded (the in-app JS countdown is suspended in the background, so we
 * schedule an OS-level local notification for the timer's end time and cancel it
 * if the timer is paused/reset/finished early). Also carries the pantry
 * low-stock alert (P3) on its own channel. No server / push involved.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isNativePlatform } from '../db/client';

const TIMER_CHANNEL_ID = 'timer';
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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
      name: '調理タイマー',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  if (permissionGranted === true) return true;
  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  permissionGranted = status === 'granted';
  return permissionGranted;
}

/**
 * Schedule a one-shot local notification `seconds` from now for the timer's end.
 * Returns the notification id (to cancel later), or null if unavailable/denied.
 */
export async function scheduleTimerNotification(seconds: number): Promise<string | null> {
  if (!isNativePlatform || seconds <= 0) return null;
  if (!(await ensureNotificationPermission())) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'タイマー終了',
        body: '調理時間が終わりました。',
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.ceil(seconds),
        channelId: TIMER_CHANNEL_ID,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Present an immediate local notification for low pantry stock (P3).
 * Returns the notification id, or null if unavailable/denied.
 */
export async function presentLowStockNotification(body: string): Promise<string | null> {
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
        title: '在庫がなくなりそうです',
        body,
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: LOW_STOCK_CHANNEL_ID } : null,
    });
  } catch {
    return null;
  }
}

/** Cancel a scheduled timer notification (no-op if already fired/absent). */
export async function cancelTimerNotification(id: string | null): Promise<void> {
  if (!isNativePlatform || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired or cancelled — nothing to do
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

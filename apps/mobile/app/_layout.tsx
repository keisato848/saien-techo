import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors, isDarkPalette } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import { markReminderFired, syncScheduledReminders } from '../src/services/reminder.service';
import { checkAndNotifyLowMaterials } from '../src/services/low-stock.service';

export default function RootLayout() {
  const { isReady, error } = useDatabase();
  const router = useRouter();

  /*
   * 起動時に資材の残量しきい値をチェックする（R12 / WBS 2.6・1日1回まとめて通知）。
   *
   * だいどこは食材の在庫（checkAndNotifyLowStock）を見ていた。食材の画面は
   * タブから外してあるので、そのままだと菜園アプリが食材の通知を出してしまう。
   */
  useEffect(() => {
    if (isReady) checkAndNotifyLowMaterials().catch(() => undefined);
  }, [isReady]);

  /*
   * リマインダーの予約を起動のたびに積み直す（R11 / WBS 2.4）。
   *
   * 次の 1 回しか予約していないので、ここで積み直さないと 2 回目が来ない。
   * OS 側の予約は再インストールや OS の掃除で勝手に消えることもあるため、
   * 「毎回まっさらから積む」を起動時の既定の動作にしている。
   */
  useEffect(() => {
    if (isReady) syncScheduledReminders().catch(() => undefined);
  }, [isReady]);

  /*
   * 通知をタップしたときの受け口（R11）。
   *
   * 「水やりの時間です」を押したら、その栽培の記録画面まで連れて行く。
   * 通知を見ただけで終わると記録が残らず、リマインダーの意味が薄れる。
   */
  useEffect(() => {
    if (!isReady) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        marker?: string;
        reminderId?: string;
        plantingId?: string;
      };
      if (data?.marker !== 'saien-reminder' || !data.plantingId) return;

      if (data.reminderId) {
        // 次回（N 日おき）の起点になるので、鳴ったことを残してから遷移する
        void markReminderFired(data.reminderId).then(() => syncScheduledReminders());
      }
      router.push(`/plantings/${data.plantingId}/care-logs/new`);
    });
    return () => subscription.remove();
  }, [isReady, router]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>DB Error: {error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.gold} size="large" />
      </View>
    );
  }

  return (
    // 画面側で useSafeAreaInsets() を使うため Provider をルートに置く。
    // だいどこは paddingTop: 54 のベタ書きだったが、端末ごとにノッチの高さが
    // 違うので実測値で組む（実機でヘッダーがステータスバーに潜り込んだ）。
    <SafeAreaProvider>
      {/* 明色パレットでは白文字のステータスバーが読めない。app.json の
          userInterfaceStyle だけでは Android の文字色は変わらないため、
          パレットの背景の明暗から決める（土案のような暗色では light に戻る）。 */}
      <StatusBar style={isDarkPalette ? 'light' : 'dark'} backgroundColor={Colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="calendar" options={{ presentation: 'modal' }} />
        <Stack.Screen name="gallery" options={{ presentation: 'modal' }} />
        <Stack.Screen name="recipes/[id]/edit" options={{ presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
  },
});

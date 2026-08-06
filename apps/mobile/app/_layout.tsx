import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OnboardingSheet } from '../src/components/OnboardingSheet';
import { Colors, isDarkPalette } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import { markReminderFired, syncScheduledReminders } from '../src/services/reminder.service';
import { checkAndNotifyLowMaterials } from '../src/services/low-stock.service';
import { runWeeklyAutoBackup } from '../src/services/backup.service';
import { getRegion, setRegion, type Region } from '../src/services/region.service';
import { updateCurrentFamilyName } from '../src/services/user.service';

export default function RootLayout() {
  const { isReady, error } = useDatabase();
  const router = useRouter();

  /*
   * 初回起動の聞き取り（WBS 3.6）。
   *
   * 地域帯が未保存 = まだ聞き取りをしていない、を初回の判定に使う。
   * 専用フラグを持たないのは、判定と実データがずれる余地を作らないため。
   * null = 判定中（この間はスピナーのまま。ホームを一瞬見せてから被せない）。
   */
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isReady) return;
    getRegion()
      .then((region) => setNeedsOnboarding(region == null))
      .catch(() => setNeedsOnboarding(false));
  }, [isReady]);

  const finishOnboarding = async (region: Region, gardenName: string) => {
    await setRegion(region);
    if (gardenName.length > 0) {
      await updateCurrentFamilyName(gardenName).catch(() => undefined);
    }
    setNeedsOnboarding(false);
  };

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
   * 週に 1 度、静かにバックアップを取る（R13 / WBS 2.8）。
   *
   * 「取ってください」と促しても取らないまま端末が壊れる。前回から 7 日
   * 空いた最初の起動でだけ動き、古い世代は 4 つ残して消す。
   * 失敗しても黙って見送る — 起動を止めるほどのことではない。
   */
  useEffect(() => {
    if (isReady) runWeeklyAutoBackup().catch(() => undefined);
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

  if (!isReady || needsOnboarding == null) {
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
      <View style={styles.appRoot}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="calendar" options={{ presentation: 'modal' }} />
          <Stack.Screen name="gallery" options={{ presentation: 'modal' }} />
        </Stack>
        {/* 初回の聞き取りは全画面のかぶせ。needsOnboarding の判定が終わるまで
            上の分岐でスピナーを出しているので、ホームが一瞬見えることはない */}
        {needsOnboarding ? <OnboardingSheet onDone={finishOnboarding} /> : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
  },
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

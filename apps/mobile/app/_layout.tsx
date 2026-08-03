import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors, isDarkPalette } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import { checkAndNotifyLowStock } from '../src/services/low-stock.service';

export default function RootLayout() {
  const { isReady, error } = useDatabase();

  // 起動時に在庫の残量しきい値をチェック（1日1回まとめて通知; P3）
  useEffect(() => {
    if (isReady) checkAndNotifyLowStock().catch(() => undefined);
  }, [isReady]);

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

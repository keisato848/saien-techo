import { Stack } from 'expo-router';

import { Colors } from '../../../src/constants/theme';

export default function PlantingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
      }}
    >
      {/* 登録・編集はルート直下ではなくこのスタックに置く。
          app/plantings/ をルートに作ると /plantings がそちらに吸われ、
          index を持たないため deep link が空画面になる（実機で踏んだ）。 */}
      <Stack.Screen name="new" options={{ presentation: 'modal' }} />
      {/* 写真から一括登録（#139 / #149）。new と同じくモーダルで開く */}
      <Stack.Screen name="identify" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/edit" options={{ presentation: 'modal' }} />
      {/* ディレクトリ名を care-logs にしているのは、.gitignore の `logs/` が
          `logs` という名前のルートを丸ごと無視してしまうため（実際に
          WBS 1.8 の 2 画面がコミットから漏れた） */}
      <Stack.Screen name="[id]/care-logs/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/care-logs/[logId]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/harvests/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/harvests/[harvestId]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/reminders/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/reminders/[reminderId]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

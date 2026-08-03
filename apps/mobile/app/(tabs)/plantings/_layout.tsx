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
      <Stack.Screen name="[id]/edit" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

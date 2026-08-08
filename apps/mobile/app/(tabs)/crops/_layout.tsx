import { Stack } from 'expo-router';

import { Colors } from '../../../src/constants/theme';

export default function CropsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
      }}
    />
  );
}

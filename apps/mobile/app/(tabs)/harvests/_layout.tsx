import { Stack } from 'expo-router';

import { Colors } from '../../../src/constants/theme';

export default function HarvestsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
      }}
    />
  );
}

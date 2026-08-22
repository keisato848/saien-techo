/**
 * S16: 地域の設定 — §9 / WBS 3.6
 *
 * 初回の聞き取りで保存した地域帯を変えるための画面。設定から入る。
 * 選んだ瞬間に保存する — 保存ボタンを挟むほどの重さの選択ではない。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RegionOptions } from '../../src/components/RegionOptions';
import { Colors, Typography } from '../../src/constants/theme';
import {
  DEFAULT_REGION,
  getRegion,
  setRegion,
  type Region,
} from '../../src/services/region.service';

export default function RegionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState<Region>(DEFAULT_REGION);

  useFocusEffect(
    useCallback(() => {
      void getRegion().then((stored) => {
        if (stored) setValue(stored);
      });
    }, []),
  );

  const change = (region: Region) => {
    setValue(region);
    void setRegion(region);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>お住まいの地域</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <RegionOptions value={value} onChange={change} />
        <Text style={styles.hint}>
          種まき・植え付け・収穫の目安（栽培暦）を、この地域帯に合わせて表示します。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  body: { padding: 16, paddingBottom: 32 },
  hint: {
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    lineHeight: 18,
    marginTop: 14,
  },
});

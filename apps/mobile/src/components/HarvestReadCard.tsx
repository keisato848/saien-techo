/**
 * 「写真の読み取り」カード — #143 / #144
 *
 * 読み取り待ち（または確認待ち）の収穫写真があるときだけ出る。庭で撮り溜めて
 * 帰宅した人が最初に目にする導線なので、ホームと収穫タブの両方に置く。
 * 無いときは何も描かない（0 件のカードは場所を取るだけ）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { getOpenReadCount } from '../services/harvest-read.service';
import { PressableScale } from './PressableScale';

export function HarvestReadCard({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const router = useRouter();
  const [count, setCount] = useState(0);

  const load = useCallback(() => {
    void getOpenReadCount()
      .then(setCount)
      // 読めなくても画面は開けるようにする（カードを出さないだけ）
      .catch(() => setCount(0));
  }, []);

  useFocusEffect(load);

  if (count === 0) return null;

  return (
    <PressableScale
      style={[styles.card, style]}
      onPress={() => router.push('/harvests/reads')}
      accessibilityLabel={`写真の読み取りが ${count} 枚待っています`}
      testID="harvest-read-card"
    >
      <View style={styles.iconWrap}>
        <Camera size={16} color={Colors.accentInk} />
      </View>
      <Text style={styles.text}>
        写真の読み取りが <Text style={styles.count}>{count} 枚</Text> 待っています
      </Text>
      <Text style={styles.chevron}>→</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  text: { flex: 1, fontSize: Typography.size.sm, color: Colors.ink },
  count: { fontWeight: Typography.weight.semibold, color: Colors.accentInk },
  chevron: { fontSize: Typography.size.sm, color: Colors.accentInk },
});

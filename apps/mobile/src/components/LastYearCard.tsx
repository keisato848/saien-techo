/**
 * 「去年の今ごろ」カード — R27 / WBS 4.9
 *
 * 去年の同じ時期（前後 2 週間）にやっていたことを、**写真を主役に**見せる。
 * 狙いは 2 シーズン目の継続（G5）。
 *
 * ## 出さない条件を先に決めている
 *
 * ホームは既に縦に長く、カードが増えて進行帯が画面外に落ちた事故がある
 * （app/(tabs)/index.tsx 冒頭の doc コメント）。このカードは
 * **去年の記録があるとき**か、**今年この時期に記録が貯まっている人へ
 * 「来年ここに並びます」と返すとき**にしか描かない。それ以外は null。
 * 判定は last-year.service に置いてあり、ここは描き分けるだけ。
 *
 * 高さは「見出し 1 行 ＋ 写真 1 行」で頭打ちになる。写真は横スクロールに
 * 逃がして、件数が増えてもカードが縦に伸びないようにしている。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import {
  describeLastYear,
  getLastYearCard,
  recordPath,
  type LastYearCard as LastYearCardData,
} from '../services/last-year.service';
import { PressableScale } from './PressableScale';

export function LastYearCard() {
  const router = useRouter();
  const [data, setData] = useState<LastYearCardData>({ state: 'none' });

  const load = useCallback(() => {
    void getLastYearCard()
      // 読めなくてもホームは開けるようにする（カードを出さないだけ）
      .then(setData)
      .catch(() => setData({ state: 'none' }));
  }, []);

  useFocusEffect(load);

  if (data.state === 'none') return null;

  // 初年度（去年の記録が無い人）。ここが R27 の空状態。
  // 「まだ記録がありません」ではなく、今年ぶんが来年効くことを返す
  if (data.state === 'this_year') {
    return (
      <View style={styles.card} testID="last-year-card">
        <Text style={styles.title}>来年の今ごろ</Text>
        <Text style={styles.promise}>
          今年のこの時期は <Text style={styles.count}>{data.entryCount}件</Text>{' '}
          記録しました。来年の今ごろ、ここに並びます。
        </Text>
      </View>
    );
  }

  const headline = describeLastYear(data.highlight);
  const others = data.entryCount - 1;

  return (
    <View style={styles.card} testID="last-year-card">
      <Text style={styles.title}>去年の今ごろ</Text>

      <PressableScale
        onPress={() => router.push(recordPath(data.highlight))}
        accessibilityLabel={`${headline}。記録を開く`}
        testID="last-year-highlight"
      >
        <Text style={styles.headline}>{headline}</Text>
      </PressableScale>

      {data.photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {data.photos.map((photo, index) => (
            <PressableScale
              key={`${photo.entryId}-${index}`}
              onPress={() => router.push(recordPath(photo))}
              accessibilityLabel="去年の写真を開く"
            >
              <Image source={{ uri: photo.uri }} style={styles.photo} />
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}

      {others > 0 ? <Text style={styles.others}>この時期の記録は ほか{others}件</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
    // 振り返りの面。行動を促すアクセント面は「つぎの作業」だけに残す
    // （docs/画面設計.md S01）
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    gap: 10,
  },
  title: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
  },
  headline: { fontSize: Typography.size.sm, color: Colors.ink, lineHeight: 20 },
  promise: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 20 },
  count: { color: Colors.accentInk, fontWeight: Typography.weight.semibold },
  photoRow: { gap: 8 },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 10,
    backgroundColor: Colors.surfaceInput,
  },
  others: { fontSize: Typography.size.xs, color: Colors.inkDim },
});

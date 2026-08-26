/**
 * 成長記録（R16 / WBS 4.4）
 *
 * 同じ栽培の写真を 2 枚並べ、撮った日と「何日目か」を添える。
 * **AI は使わない**（要件定義 R16。変化を言葉にするのは R32 の別立て）。
 *
 * ## 定点で撮っていない前提で作る
 *
 * このアプリに定点撮影の補助（前回写真のゴースト重ね）は無い。
 * `expo-camera` を WBS 2.9d で削除していて、`expo-image-picker` は
 * OS 標準のカメラ UI を開くだけなのでプレビューに重ねられない。
 * なので**重ねるスライダーは作らず、横に並べる**。角度も距離も揃っていない
 * 2 枚を重ねても「成長の比較」にならず、ズレが目立つだけになる。
 *
 * ## 写真が見つからないとき
 *
 * `photos` に行があってもファイルが無いことがある（バックアップ後に
 * 元の記録を消してから復元した場合など）。素の `<Image>` は黙って空白を出すので、
 * `onError` を拾って**その 1 枚を「見つかりません」に差し替え、別の写真を選べる**ようにする。
 * 使える写真が 2 枚に満たなくなったら成長記録自体をたたむ。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../../../../src/constants/theme';
import {
  daysBetween,
  getGrowthPhotos,
  MIN_COMPARE_PHOTOS,
  type GrowthPhoto,
} from '../../../../src/services/growth-compare.service';

type Side = 'left' | 'right';

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function GrowthCompareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [photos, setPhotos] = useState<GrowthPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  /** 表示できなかった写真の index。ファイルが消えている場合に入る */
  const [missing, setMissing] = useState<number[]>([]);
  const [leftIndex, setLeftIndex] = useState<number | null>(null);
  const [rightIndex, setRightIndex] = useState<number | null>(null);
  // 差し替え先を選ぶときに「反対側がいま何か」を最新の値で見るための控え
  const leftIndexRef = useRef<number | null>(null);
  const rightIndexRef = useRef<number | null>(null);
  leftIndexRef.current = leftIndex;
  rightIndexRef.current = rightIndex;
  const [active, setActive] = useState<Side>('right');

  const load = useCallback(async () => {
    if (!id) return;
    const list = await getGrowthPhotos(id);
    setPhotos(list);
    // **選び直した左右と「見つからなかった」印はリセットしない。**
    // この画面はタブ移動のたびに再取得されるので、毎回いちばん古い×新しいへ
    // 戻すとユーザーが選んだ組み合わせが消える。既定を入れるのは初回だけ
    setLeftIndex((prev) => (prev != null ? prev : list.length > 0 ? 0 : null));
    setRightIndex((prev) => (prev != null ? prev : list.length > 1 ? list.length - 1 : null));
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const usable = useMemo(
    () => photos.filter((photo) => !missing.includes(photo.index)),
    [photos, missing],
  );

  const left = leftIndex != null ? photos[leftIndex] : undefined;
  const right = rightIndex != null ? photos[rightIndex] : undefined;
  const leftMissing = left ? missing.includes(left.index) : false;
  const rightMissing = right ? missing.includes(right.index) : false;

  /**
   * 表示に失敗した写真を控え、その枠には**まだ生きている別の写真**を入れ直す。
   * 入れ替え先が無ければ null にして「選び直してください」を出す。
   */
  const handleImageError = useCallback(
    (photo: GrowthPhoto, side: Side) => {
      // **すべて関数形の更新で書く。** 左右が同時に失敗すると、直前のレンダーの
      // missing / leftIndex / rightIndex を読む書き方では両方が同じ写真に落ちる
      setMissing((prevMissing) => {
        const nextMissing = prevMissing.includes(photo.index)
          ? prevMissing
          : [...prevMissing, photo.index];

        const pick = (other: number | null): number | null => {
          // 左は古い側から、右は新しい側から探す（並びの意味を壊さない）
          const candidates = side === 'left' ? photos : [...photos].reverse();
          const found = candidates.find(
            (candidate) => candidate.index !== other && !nextMissing.includes(candidate.index),
          );
          return found ? found.index : null;
        };

        if (side === 'left') setLeftIndex((_prev) => pick(rightIndexRef.current));
        else setRightIndex((_prev) => pick(leftIndexRef.current));
        return nextMissing;
      });
    },
    [photos],
  );

  const handleSelect = useCallback(
    (photo: GrowthPhoto) => {
      // 反対側と同じ写真を選んだら**入れ替える**。同じ 2 枚を並べても比較にならず、
      // かといって無反応だと「押せないボタン」に見える
      if (active === 'left') {
        if (photo.index === rightIndexRef.current) setRightIndex(leftIndexRef.current);
        setLeftIndex(photo.index);
      } else {
        if (photo.index === leftIndexRef.current) setLeftIndex(rightIndexRef.current);
        setRightIndex(photo.index);
      }
    },
    [active],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
        <ChevronLeft size={22} color={Colors.ink} />
      </Pressable>
      <Text style={styles.title}>成長記録</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <Text style={styles.empty}>読み込んでいます…</Text>
      </View>
    );
  }

  if (usable.length < MIN_COMPARE_PHOTOS) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.emptyBox}>
          <Text style={styles.empty}>
            成長記録には、この栽培の写真が {MIN_COMPARE_PHOTOS} 枚以上必要です。
          </Text>
          <Text style={styles.emptySub}>
            {missing.length > 0
              ? '端末から消えている写真があります。作業ログや収穫に写真を足すと、ここに並びます。'
              : '作業ログや収穫に写真を足すと、ここに並びます。'}
          </Text>
        </View>
      </View>
    );
  }

  const gap = left && right && !leftMissing && !rightMissing ? daysBetween(left, right) : null;

  return (
    <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.pair}>
          {(['left', 'right'] as const).map((side) => {
            const photo = side === 'left' ? left : right;
            const isMissing = side === 'left' ? leftMissing : rightMissing;
            return (
              <Pressable
                key={side}
                style={[styles.pane, active === side && styles.paneActive]}
                onPress={() => setActive(side)}
                accessibilityLabel={side === 'left' ? '左の写真を選ぶ' : '右の写真を選ぶ'}
              >
                {photo && !isMissing ? (
                  <>
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.paneImage}
                      resizeMode="cover"
                      onError={() => handleImageError(photo, side)}
                      accessibilityLabel={`${photo.elapsedDays}日目の写真`}
                    />
                    <Text style={styles.paneDay}>{photo.elapsedDays} 日目</Text>
                    <Text style={styles.paneDate}>{formatDay(photo.loggedAt)}</Text>
                  </>
                ) : (
                  <View style={styles.paneImagePlaceholder}>
                    <Text style={styles.placeholderText}>
                      {isMissing || photo == null ? '写真が見つかりません' : ''}
                    </Text>
                    <Text style={styles.placeholderSub}>下から選び直してください</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {gap != null && gap > 0 ? <Text style={styles.gap}>この間 {gap} 日</Text> : null}

        <Text style={styles.stripLabel}>
          {active === 'left' ? '左に入れる写真を選ぶ' : '右に入れる写真を選ぶ'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.strip}>
            {photos.map((photo) => {
              const gone = missing.includes(photo.index);
              const selected = photo.index === leftIndex || photo.index === rightIndex;
              return (
                <Pressable
                  key={photo.index}
                  onPress={() => handleSelect(photo)}
                  disabled={gone}
                  accessibilityLabel={`${photo.elapsedDays}日目を選ぶ`}
                  style={[styles.thumbWrap, selected && styles.thumbWrapSelected]}
                >
                  {gone ? (
                    <View style={[styles.thumb, styles.thumbGone]}>
                      <Text style={styles.thumbGoneText}>×</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.thumb}
                      resizeMode="cover"
                      onError={() =>
                        setMissing((prev) =>
                          prev.includes(photo.index) ? prev : [...prev, photo.index],
                        )
                      }
                    />
                  )}
                  <Text style={styles.thumbDay}>{photo.elapsedDays}日</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
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
  title: { fontSize: Typography.size.lg, fontWeight: '700', color: Colors.ink },
  body: { padding: 16, gap: 16, paddingBottom: 32 },
  empty: { padding: 16, fontSize: Typography.size.sm, color: Colors.inkDim, textAlign: 'center' },
  emptyBox: { padding: 24, gap: 8 },
  emptySub: { fontSize: Typography.size.xs, color: Colors.inkDim, textAlign: 'center' },
  pair: { flexDirection: 'row', gap: 10 },
  pane: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 4,
  },
  paneActive: { borderColor: Colors.accent },
  paneImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: Colors.surfaceInput,
  },
  paneImagePlaceholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: Colors.surfaceInput,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
  },
  placeholderText: { fontSize: Typography.size.sm, color: Colors.inkDim, textAlign: 'center' },
  placeholderSub: { fontSize: Typography.size.xs, color: Colors.inkDim, textAlign: 'center' },
  paneDay: {
    marginTop: 6,
    fontSize: Typography.size.md,
    fontWeight: '700',
    color: Colors.accentInk,
  },
  paneDate: { fontSize: Typography.size.xs, color: Colors.inkDim },
  gap: { textAlign: 'center', fontSize: Typography.size.sm, color: Colors.inkDim },
  stripLabel: { fontSize: Typography.size.xs, color: Colors.inkDim },
  strip: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  thumbWrap: {
    alignItems: 'center',
    gap: 2,
    borderRadius: 8,
    padding: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbWrapSelected: { borderColor: Colors.accentLine },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: Colors.surfaceInput },
  thumbGone: { alignItems: 'center', justifyContent: 'center' },
  thumbGoneText: { fontSize: Typography.size.md, color: Colors.inkDim },
  thumbDay: { fontSize: Typography.size.xs, color: Colors.inkDim },
});

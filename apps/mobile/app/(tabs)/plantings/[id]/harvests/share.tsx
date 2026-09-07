/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）
 *
 * 収穫の詳細（`[harvestId].tsx`）から開く。押した人だけが共有シートを開く —
 * **画面を開いただけでは何も外へ出ない**。
 *
 * ## 出す前に見せる
 *
 * 共有は取り消せない。だから「写真」「ことば」「位置情報は消すこと」を
 * 先に全部見せてから 1 回だけ押させる。確認ダイアログは挟まない — この画面が
 * 確認そのものなので、ダイアログを足すと同じことを 2 回訊くことになる。
 *
 * ## ボタンが 2 つある理由
 *
 * Android の共有は写真とことばを同時に運べない（`harvest-share.service.ts` 参照）。
 * 写真を送るか、ことばを送るかは**送り先で変わる**（写真アプリへは写真、
 * 一言だけ伝えたい相手にはことば）ので、隠さずに 2 つ並べて選ばせる。
 * iOS は 1 回で両方渡るが、ボタンの構成は変えない — 端末で説明が食い違うと
 * 使い方を教え合えなくなる。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MessageSquare, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../../../src/components/EmptyState';
import { HarvestShareCardView } from '../../../../../src/components/HarvestShareCardView';
import { Loading } from '../../../../../src/components/Loading';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  formatHarvestShareText,
  getHarvestShareCard,
  shareHarvestCard,
  type HarvestShareCard,
} from '../../../../../src/services/harvest-share.service';

export default function ShareHarvestScreen() {
  const { harvestId } = useLocalSearchParams<{ id: string; harvestId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [card, setCard] = useState<HarvestShareCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // ファイルが消えている写真。DB に行があってもファイルが無いことがある
  // （成長記録と同じ事情 — compare.tsx のコメント参照）
  const [photoMissing, setPhotoMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPhotoMissing(false);

    void (async () => {
      const found = harvestId ? await getHarvestShareCard(harvestId) : null;
      if (cancelled) return;
      setCard(found);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [harvestId]);

  const handleShare = useCallback(
    (textOnly: boolean) => {
      if (!card || busy) return;
      setBusy(true);

      // 写真が描けなかったものは共有からも外す。共有シートで初めて
      // 「開けません」と言われるより、渡さないほうがまだ分かりやすい
      const payload = photoMissing ? { ...card, photoUri: null } : card;

      void shareHarvestCard(payload, { textOnly })
        .then((outcome) => {
          if (!textOnly && payload.photoUri != null && outcome === 'text') {
            Alert.alert(
              '写真は共有できませんでした',
              'ことばだけを共有シートへ渡しました。写真をもう一度撮り直すと共有できます。',
            );
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'もう一度お試しください。';
          Alert.alert('共有できませんでした', message);
        })
        .finally(() => setBusy(false));
    },
    [busy, card, photoMissing],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
        <ChevronLeft size={22} color={Colors.ink} />
      </Pressable>
      <Text style={styles.title}>収穫を共有</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <Loading />
      </View>
    );
  }

  if (!card) {
    return (
      <View style={styles.root}>
        {header}
        <EmptyState
          title="この収穫は見つかりませんでした"
          message="削除されたか、別の端末で消された可能性があります。"
          actionLabel="戻る"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const hasPhoto = card.photoUri != null && !photoMissing;

  return (
    <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <HarvestShareCardView
          card={card}
          photoHidden={photoMissing}
          onPhotoError={() => setPhotoMissing(true)}
        />

        <View style={styles.textBox}>
          <Text style={styles.textLabel}>いっしょに送ることば</Text>
          <Text style={styles.text}>{formatHarvestShareText(card)}</Text>
        </View>

        <Text style={styles.notice}>
          {hasPhoto
            ? '写真は位置情報を消してから書き出します。送り先はこの端末の共有シートで選びます。'
            : photoMissing
              ? // 写真の行はあるのにファイルが無い。「写真がありません」と言うと
                // 記録し忘れたように読めるので、消えていることをそのまま伝える
                'この収穫の写真が端末で見つかりませんでした。ことばだけを共有します。'
              : 'この収穫には写真がないので、ことばだけを共有します。'}
        </Text>
        {hasPhoto && card.photoCount > 1 ? (
          <Text style={styles.notice}>写真は 1 枚目だけを共有します。</Text>
        ) : null}

        {hasPhoto ? (
          <PressableScale
            style={[styles.primary, busy && styles.disabled]}
            onPress={() => handleShare(false)}
            disabled={busy}
            accessibilityLabel="写真を共有する"
          >
            <Share2 size={18} color={Colors.onAccent} />
            <Text style={styles.primaryText}>写真を共有</Text>
          </PressableScale>
        ) : null}

        <PressableScale
          style={[hasPhoto ? styles.secondary : styles.primary, busy && styles.disabled]}
          onPress={() => handleShare(true)}
          disabled={busy}
          accessibilityLabel="ことばだけ共有する"
        >
          <MessageSquare size={18} color={hasPhoto ? Colors.accentInk : Colors.onAccent} />
          <Text style={hasPhoto ? styles.secondaryText : styles.primaryText}>ことばだけ共有</Text>
        </PressableScale>
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
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.medium, color: Colors.ink },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  textBox: {
    backgroundColor: Colors.surfaceInput,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  textLabel: { fontSize: Typography.size.xs, color: Colors.inkDim },
  text: { fontSize: Typography.size.base, color: Colors.ink, lineHeight: 22 },
  notice: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.surface,
    paddingVertical: 13,
  },
  secondaryText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
  disabled: { opacity: 0.5 },
});

/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）
 *
 * 収穫の編集（`[harvestId].tsx`）から開く。押した人だけが共有シートを開く —
 * **画面を開いただけでは何も外へ出ない**。
 *
 * ## 出す前に見せる
 *
 * 共有は取り消せない。だから**外へ出る 1 枚そのもの**を先に見せてから押させる。
 * 確認ダイアログは挟まない — この画面が確認そのものなので、ダイアログを足すと
 * 同じことを 2 回訊くことになる。
 *
 * ## 写真の待ち合わせ
 *
 * カードは画面に描かれている SVG をそのまま書き出す。Android の RNSVG は
 * 写真が Fresco のメモリキャッシュに載るまで描かないので、**`onLoad` が来るまで
 * 共有ボタンを押させない**（詳しくは `harvest-share.service.ts` 冒頭）。
 * 来ないまま時間切れになったら写真を諦め、ことばだけのカードへ落とす —
 * 押せないボタンの前で止まるより、採れたことが伝わるほうが目的に近い。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MessageSquare, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type Svg from 'react-native-svg';

import { EmptyState } from '../../../../../src/components/EmptyState';
import { HarvestShareCardImage } from '../../../../../src/components/HarvestShareCardImage';
import { Loading } from '../../../../../src/components/Loading';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  captureShareCard,
  formatHarvestShareText,
  getHarvestShareCard,
  prepareSharePhoto,
  shareHarvestCard,
  type HarvestShareCard,
} from '../../../../../src/services/harvest-share.service';

/** 写真が描かれるのを待つ上限。これを過ぎたらことばだけのカードにする */
export const PHOTO_LOAD_TIMEOUT_MS = 6_000;

/** カードの表示幅の上限（dp）。タブレットで間延びさせない */
const MAX_CARD_WIDTH = 420;

type PhotoState =
  /** そもそも写真の無い収穫 */
  | 'none'
  /** 位置情報を落としている最中 */
  | 'preparing'
  /** 描かれるのを待っている */
  | 'waiting'
  /** 描けた。書き出してよい */
  | 'ready'
  /** 落とせなかった・描けなかった。写真は諦める */
  | 'unavailable';

export default function ShareHarvestScreen() {
  const { harvestId } = useLocalSearchParams<{ id: string; harvestId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const cardRef = useRef<Svg | null>(null);

  const [card, setCard] = useState<HarvestShareCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<PhotoState>('none');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPhotoUri(null);
    setPhotoState('none');

    void (async () => {
      const found = harvestId ? await getHarvestShareCard(harvestId) : null;
      if (cancelled) return;
      setCard(found);
      setLoading(false);
      if (!found?.photoUri) return;

      // 位置情報は**プレビューへ載せる前に**落とす。画面に出した uri が
      // そのまま書き出しの素材になるので、ここを飛ばすと原本が焼き込まれる
      setPhotoState('preparing');
      const prepared = await prepareSharePhoto(found.photoUri);
      if (cancelled) return;
      setPhotoUri(prepared);
      setPhotoState(prepared ? 'waiting' : 'unavailable');
    })();

    return () => {
      cancelled = true;
    };
  }, [harvestId]);

  // 描かれない写真をいつまでも待たない
  useEffect(() => {
    if (photoState !== 'waiting') return;
    const timer = setTimeout(() => setPhotoState('unavailable'), PHOTO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [photoState]);

  const handleShare = useCallback(
    (textOnly: boolean) => {
      if (!card || busy) return;
      setBusy(true);

      void shareHarvestCard(
        card,
        textOnly ? { textOnly: true } : { captureCard: () => captureShareCard(cardRef.current) },
      )
        .then((outcome) => {
          if (!textOnly && outcome === 'text') {
            Alert.alert(
              'カードを書き出せませんでした',
              'ことばだけを共有シートへ渡しました。もう一度開き直すと書き出せることがあります。',
            );
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'もう一度お試しください。';
          Alert.alert('共有できませんでした', message);
        })
        .finally(() => setBusy(false));
    },
    [busy, card],
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

  const waiting = photoState === 'preparing' || photoState === 'waiting';
  const cardWidth = Math.min(windowWidth - 32, MAX_CARD_WIDTH);

  return (
    <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.cardWrap}>
          <HarvestShareCardImage
            ref={cardRef}
            card={card}
            photoUri={photoState === 'ready' || photoState === 'waiting' ? photoUri : null}
            onPhotoLoad={() => setPhotoState('ready')}
            width={cardWidth}
          />
        </View>

        <Text style={styles.notice}>
          この 1 枚がそのまま外へ出ます。作物名・数量・日付と「さいえん手帳」は写真に焼き込むので、
          写真だけを送る相手にも何が採れたか伝わります。写真の位置情報は消してから書き出します。
        </Text>

        {photoState === 'unavailable' ? (
          // 写真の行はあるのにファイルが読めない。「写真がありません」と言うと
          // 記録し忘れたように読めるので、読めなかったことをそのまま伝える
          <Text style={styles.notice}>
            この収穫の写真を読み込めませんでした。ことばだけのカードを共有します。
          </Text>
        ) : null}
        {photoState === 'none' ? (
          <Text style={styles.notice}>
            この収穫には写真がないので、ことばだけのカードになります。
          </Text>
        ) : null}
        {photoState !== 'none' && photoState !== 'unavailable' && card.photoCount > 1 ? (
          <Text style={styles.notice}>写真は 1 枚目だけがカードに載ります。</Text>
        ) : null}

        <PressableScale
          style={[styles.primary, (busy || waiting) && styles.disabled]}
          onPress={() => handleShare(false)}
          disabled={busy || waiting}
          accessibilityLabel="カードを共有する"
        >
          <Share2 size={18} color={Colors.onAccent} />
          <Text style={styles.primaryText}>
            {waiting ? '写真を読み込んでいます' : 'カードを共有'}
          </Text>
        </PressableScale>

        <View style={styles.textBox}>
          <Text style={styles.textLabel}>ことばだけ共有するときに送る文</Text>
          <Text style={styles.text}>{formatHarvestShareText(card)}</Text>
        </View>

        <PressableScale
          style={[styles.secondary, busy && styles.disabled]}
          onPress={() => handleShare(true)}
          disabled={busy}
          accessibilityLabel="ことばだけ共有する"
        >
          <MessageSquare size={18} color={Colors.accentInk} />
          <Text style={styles.secondaryText}>ことばだけ共有</Text>
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
  cardWrap: { alignItems: 'center' },
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

/**
 * 写真の読み取り（「写真から記録」のまとめて処理 — #143 / #144）
 *
 * 庭で撮り溜めた収穫写真を、帰宅後にまとめて読み取る画面。
 *
 * - **記録はもう保存済み。** ここで読めるのは「数量の下書き」だけで、
 *   読めなくても失われるものは無い
 * - 通行権は 2 つ: 無料枠（インストールごとに 1 枚）と、動画リワード（1 本 = 最大
 *   READS_PER_REWARD 枚）。**視聴完了（rewarded）を確認してから**印を付けて送る
 * - paid 印が残っていれば開いた時に自動で再開する（リワードの履行 — 途中で
 *   通信が切れても、約束した枚数は広告なしで読み切る）
 * - 結果は必ず確認を挟む: 「N 個 — 合っていますか？」→ 記録する / 直す / しない
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, ChevronLeft, PlayCircle } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import { getAdRewardProvider, isAdRewardAvailable } from '../../../src/services/ad-reward.service';
import {
  applyRead,
  dismissRead,
  getReadQueue,
  grantFreeRead,
  markPaidForReward,
  processPaidReads,
  READS_PER_REWARD,
  type HarvestReadItem,
} from '../../../src/services/harvest-read.service';
import { getFreemiumStatus } from '../../../src/services/usage.service';

function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function HarvestReadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<HarvestReadItem[]>([]);
  const [canUseFree, setCanUseFree] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 二重処理を防ぐ（useFocusEffect はタブ切り替えのたびに走る）
  const processingRef = useRef(false);

  const load = useCallback(async () => {
    const [queue, status] = await Promise.all([getReadQueue(), getFreemiumStatus()]);
    setItems(queue);
    setCanUseFree(status.canInfer && queue.some((item) => item.state === 'pending' && !item.paid));
  }, []);

  const runProcess = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      await processPaidReads((progress) => {
        setProgressText(`読み取り中… ${progress.done}/${progress.total}`);
        void load();
      });
    } finally {
      processingRef.current = false;
      setProcessing(false);
      setProgressText(null);
      await load();
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await load();
        // paid 印の残り（前回の中断ぶん）は開いた時に自動で読み切る（履行）
        const leftover = (await getReadQueue()).some(
          (item) => item.state === 'pending' && item.paid,
        );
        if (leftover) void runProcess();
      })();
    }, [load, runProcess]),
  );

  const handleFree = useCallback(async () => {
    setMessage(null);
    const granted = await grantFreeRead();
    if (!granted) {
      setMessage('無料の読み取りは使い切りました。');
      await load();
      return;
    }
    await runProcess();
  }, [load, runProcess]);

  const handleReward = useCallback(async () => {
    setMessage(null);
    try {
      const outcome = await getAdRewardProvider().showRewardedAd();
      // **視聴完了のときだけ**印を付けて送る（#144 の不変条件）。
      // 途中で閉じた・在庫が無かったときは 1 件も送らない
      if (!outcome.rewarded) {
        setMessage('動画が最後まで再生されませんでした。もう一度お試しください。');
        return;
      }
      await markPaidForReward();
      await runProcess();
    } catch {
      setMessage('広告を読み込めませんでした。時間をおいてお試しください。');
    }
  }, [runProcess]);

  const pendingUnpaid = items.filter((item) => item.state === 'pending' && !item.paid).length;
  const rewardCount = Math.min(READS_PER_REWARD, pendingUnpaid);
  const showReward = rewardCount > 0 && isAdRewardAvailable();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <PressableScale onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={24} color={Colors.ink} />
        </PressableScale>
        <Text style={styles.headerTitle}>写真の読み取り</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {items.length === 0 ? (
          <EmptyState
            icon="🧺"
            title="読み取り待ちはありません"
            message="数量を入れずに写真だけで収穫を記録すると、ここに並びます。"
          />
        ) : (
          <>
            {/* 外へ出る操作は黙らない（#143）。この画面の送信はすべて明示の操作から */}
            <Text style={styles.caption}>写真を送って、作物と数量を読み取ります。</Text>

            {canUseFree && !processing ? (
              <PressableScale
                style={styles.primaryButton}
                onPress={() => void handleFree()}
                accessibilityLabel="無料で 1 枚読み取る"
              >
                <Camera size={16} color={Colors.onAccent} />
                <Text style={styles.primaryButtonText}>無料で 1 枚読み取る</Text>
              </PressableScale>
            ) : null}

            {showReward && !processing ? (
              <PressableScale
                style={styles.rewardButton}
                onPress={() => void handleReward()}
                accessibilityLabel={`動画を見て ${rewardCount} 枚を読み取る`}
              >
                <PlayCircle size={16} color={Colors.accentInk} />
                <Text style={styles.rewardButtonText}>動画を見て {rewardCount} 枚を読み取る</Text>
              </PressableScale>
            ) : null}

            {progressText ? (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color={Colors.accentInk} />
                <Text style={styles.progressText}>{progressText}</Text>
              </View>
            ) : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}

            {items.map((item) => (
              <ReadRow
                key={item.harvestId}
                item={item}
                processing={processing}
                onApply={async () => {
                  await applyRead(item.harvestId);
                  await load();
                }}
                onDismiss={async () => {
                  await dismissRead(item.harvestId);
                  await load();
                }}
                onEdit={() =>
                  router.push(`/plantings/${item.plantingId}/harvests/${item.harvestId}`)
                }
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ReadRow({
  item,
  processing,
  onApply,
  onDismiss,
  onEdit,
}: {
  item: HarvestReadItem;
  processing: boolean;
  onApply: () => Promise<void>;
  onDismiss: () => Promise<void>;
  onEdit: () => void;
}) {
  const stateLine = (() => {
    if (item.state === 'pending') {
      if (item.paid) return processing ? '読み取り中…' : 'まもなく読み取ります';
      return '読み取り待ち';
    }
    if (item.state === 'failed') {
      return item.readNote ?? '読み取れませんでした。数量は手で入力できます。';
    }
    return null;
  })();

  return (
    <View style={styles.row}>
      {item.photoUri ? (
        <Image source={{ uri: item.photoUri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Camera size={18} color={Colors.inkDim} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {item.cropName} <Text style={styles.rowDate}>{formatDay(item.harvestedAt)}</Text>
        </Text>

        {item.state === 'analyzed' ? (
          item.count != null ? (
            <>
              <Text style={styles.resultLine}>
                {item.cropGuess ?? item.cropName} {item.count} 個 — 合っていますか？
              </Text>
              {item.readNote ? <Text style={styles.noteLine}>{item.readNote}</Text> : null}
              <View style={styles.actions}>
                <PressableScale
                  style={styles.applyButton}
                  onPress={() => void onApply()}
                  accessibilityLabel="この数量で記録する"
                >
                  <Text style={styles.applyText}>記録する</Text>
                </PressableScale>
                <PressableScale style={styles.ghostButton} onPress={onEdit}>
                  <Text style={styles.ghostText}>直す</Text>
                </PressableScale>
                <PressableScale
                  style={styles.ghostButton}
                  onPress={() => void onDismiss()}
                  accessibilityLabel="この読み取りを使わない"
                >
                  <Text style={styles.ghostText}>しない</Text>
                </PressableScale>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.noteLine}>
                {item.readNote ?? '数えられませんでした。数量は手で入力できます。'}
              </Text>
              <View style={styles.actions}>
                <PressableScale style={styles.ghostButton} onPress={onEdit}>
                  <Text style={styles.ghostText}>数量を入力</Text>
                </PressableScale>
                <PressableScale style={styles.ghostButton} onPress={() => void onDismiss()}>
                  <Text style={styles.ghostText}>しない</Text>
                </PressableScale>
              </View>
            </>
          )
        ) : (
          <>
            {stateLine ? <Text style={styles.noteLine}>{stateLine}</Text> : null}
            {item.state === 'failed' ? (
              <View style={styles.actions}>
                <PressableScale style={styles.ghostButton} onPress={onEdit}>
                  <Text style={styles.ghostText}>数量を入力</Text>
                </PressableScale>
                <PressableScale style={styles.ghostButton} onPress={() => void onDismiss()}>
                  <Text style={styles.ghostText}>しない</Text>
                </PressableScale>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerSpacer: { width: 24 },
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  caption: { fontSize: Typography.size.xs, color: Colors.inkDim },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
  },
  primaryButtonText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  rewardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.surfaceInput,
    borderRadius: 12,
    paddingVertical: 12,
  },
  rewardButtonText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  message: { fontSize: Typography.size.sm, color: Colors.ink },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 12,
  },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: Colors.surfaceInput },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  rowDate: { color: Colors.inkDim, fontWeight: Typography.weight.regular },
  resultLine: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
  },
  noteLine: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  applyButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  applyText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  ghostText: { fontSize: Typography.size.sm, color: Colors.ink },
});

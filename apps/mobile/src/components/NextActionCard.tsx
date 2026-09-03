/**
 * 「つぎの作業」カード — R10 / WBS 3.4
 *
 * ホームの最上段（行動を促すもの）。栽培×ガイドの突き合わせ結果を並べ、
 * 「記録する」で該当の記録画面へ、「あとで」で 3 日先送り。
 * 提案が無ければカードごと出さない。
 *
 * **表示は上位 VISIBLE_COUNT 件で打ち切り、残りは「ほかN件」の1行にまとめる**
 * （2026-09-01）。getNextActions() はサービス側で最大10件返すため、栽培が増えると
 * このカードが際限なく縦に伸び、下にある「育てているもの」（進行帯）が画面外に
 * 落ちる — ホームのカード順を入れ替えただけでは栽培数が増えると再発する
 * （index.tsx 冒頭の doc コメント参照）。並び順（優先度）はサービス側のまま変えず、
 * ここでは表示件数を slice するだけにとどめる。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import {
  describeNextAction,
  getNextActions,
  snoozeNextAction,
  type NextAction,
} from '../services/next-action.service';

/** カードで通常表示する件数。これを超える分は「ほかN件」に畳む */
const VISIBLE_COUNT = 2;

export function NextActionCard() {
  const router = useRouter();
  const [actions, setActions] = useState<NextAction[]>([]);

  const load = useCallback(() => {
    void getNextActions()
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  useFocusEffect(load);

  if (actions.length === 0) return null;

  const visibleActions = actions.slice(0, VISIBLE_COUNT);
  const hiddenCount = actions.length - visibleActions.length;

  const record = (action: NextAction) => {
    router.push(
      action.kind === 'harvest'
        ? `/plantings/${action.plantingId}/harvests/new`
        : `/plantings/${action.plantingId}/care-logs/new?kind=fertilize`,
    );
  };

  const later = (action: NextAction) => {
    void snoozeNextAction(action.plantingId, action.kind).then(load);
  };

  return (
    <View style={styles.card} testID="next-action-card">
      <Text style={styles.title}>つぎの作業</Text>
      {visibleActions.map((action) => (
        <View key={`${action.plantingId}-${action.kind}`} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.crop}>{action.cropName}</Text>
            <Text style={styles.description}>{describeNextAction(action)}</Text>
          </View>
          <View style={styles.buttons}>
            <Pressable
              style={styles.recordButton}
              onPress={() => record(action)}
              accessibilityLabel={`${action.cropName}の${action.kind === 'harvest' ? '収穫' : '追肥'}を記録する`}
            >
              <Text style={styles.recordText}>記録する</Text>
            </Pressable>
            <Pressable
              style={styles.laterButton}
              onPress={() => later(action)}
              hitSlop={6}
              accessibilityLabel={`${action.cropName}の提案をあとで`}
            >
              <Text style={styles.laterText}>あとで</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <Pressable
          onPress={() => router.push('/plantings')}
          hitSlop={6}
          accessibilityLabel={`ほかの提案${hiddenCount}件を栽培一覧で見る`}
          testID="next-action-more"
        >
          <Text style={styles.moreText}>ほか{hiddenCount}件 →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
    // 行動を促す面。ホームで唯一のアクセント面にする（画面設計 S01）
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    gap: 12,
  },
  title: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.accentInk,
  },
  row: { gap: 8 },
  rowText: { gap: 2 },
  crop: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  description: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 19 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  recordButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.accent,
  },
  recordText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  laterButton: { paddingVertical: 8 },
  laterText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  // 「作物ガイドをみる →」（MonthlyWorkCard）と同じ、面のリンク表現に合わせる
  moreText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
});

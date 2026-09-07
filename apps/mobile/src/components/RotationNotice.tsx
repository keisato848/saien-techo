/**
 * 連作の注意書き — R17 / WBS 4.5
 *
 * 栽培フォームの「場所」の下に出す。**保存を妨げない**ので、
 * ボタンも「閉じる」も持たない読み物にしてある。
 *
 * 色は danger（赤系）の罫線だけを借りて、面は通常のカードのままにした。
 * dangerSoft を敷くと削除の確認と同じ強さに見え、「登録してはいけない」と
 * 受け取られる — ここで伝えたいのは事実と目安だけ。
 */
import { AlertTriangle } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import {
  describeRotationWarning,
  rotationTimingLabel,
  type RotationWarning,
} from '../services/rotation.service';

interface RotationNoticeProps {
  warning: RotationWarning | null;
}

export function RotationNotice({ warning }: RotationNoticeProps) {
  if (!warning) return null;

  // 先頭の 1 件は本文の中で名指ししているので、残りだけを一覧にする
  const others = warning.history.slice(1);

  return (
    <View
      style={styles.card}
      testID="rotation-notice"
      accessibilityLabel={describeRotationWarning(warning)}
    >
      <View style={styles.titleRow}>
        <AlertTriangle size={15} color={Colors.danger} />
        <Text style={styles.title}>同じ科がつづきます</Text>
      </View>
      <Text style={styles.body}>{describeRotationWarning(warning)}</Text>
      {others.length > 0 ? (
        <Text style={styles.others}>
          ほかにも {others.map((e) => `${rotationTimingLabel(e)} ${e.cropName}`).join('、')}
        </Text>
      ) : null}
      {/* 「このまま登録できます」を必ず添える。警告だけ出して逃げ道を書かないと、
          限られた区画しか持たない人が場所の記録をやめてしまう */}
      <Text style={styles.footer}>
        目安なので、このまま登録できます。土を入れ替える・接ぎ木苗を使うなどの手もあります。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dangerLine,
    backgroundColor: Colors.surface,
    gap: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
  },
  body: { fontSize: Typography.size.sm, color: Colors.ink, lineHeight: 20 },
  others: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 20 },
  footer: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18 },
});

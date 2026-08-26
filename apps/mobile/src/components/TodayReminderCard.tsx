/**
 * 「今日のリマインダー」カード — R11 / WBS 3.5
 *
 * ホーム最上段。自分で設定した予定なので、アプリが出す提案（つぎの作業）より
 * 上に置く。ただし**アクセント面は「つぎの作業」に譲る** — ホームで唯一の
 * アクセント面という取り決め（画面設計 S01）を崩さないため、ここは通常面にする。
 * 予定（事実）→ 提案（行動）の順に読ませる。
 *
 * 時刻を過ぎた予定も残す。朝 7 時の水やりを 18 時に確かめたいことの方が多く、
 * 過ぎたら消える一覧では「やったか分からない」が残るため。
 * 済みの判定はリマインダーではなく**その日の記録の有無**で行う（reminder.service）。
 *
 * ## 「済ませる」導線（2026-08-26）
 *
 * 以前は行全体が押せるだけで、**押せることが見た目から分からなかった**
 * （矢印もボタンも無く、ただの一覧に見える。実機で「完了できない」と指摘された）。
 * 行の右端に「記録」ボタンを出す。
 *
 * - **ボタン = 1 タップで記録**（栽培詳細の「やった！を記録」と同じ挙動）。
 *   チェックだけ付ける方式は採らない — 記録が残らないと手帳の意味が消えるため、
 *   済みの判定は引き続き「その日の記録があるか」に一本化する
 * - **行の他の場所 = 写真やメモを付ける記録画面へ**（従来どおり）
 *
 * ボタンは**塗りにしない**。ホームで唯一のアクセント面は「つぎの作業」という
 * 取り決め（画面設計 S01）があり、塗ると 2 つのカードが同じ強さで競う。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { CARE_KIND_LABEL, createCareLog } from '../services/care-log.service';
import { getTodayReminders, type TodayReminder } from '../services/reminder.service';
import { PressableScale } from './PressableScale';

/** 「7:05」。分は 2 桁に揃えないと行ごとに幅が揺れる */
export function formatReminderTime(at: Date): string {
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export function TodayReminderCard() {
  const router = useRouter();
  const [reminders, setReminders] = useState<TodayReminder[]>([]);
  /** 二度押しで 2 件記録されるのを防ぐ */
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    void getTodayReminders()
      .then(setReminders)
      // 読めなくてもホームは開けるようにする（カードを出さないだけ）
      .catch(() => setReminders([]));
  }, []);

  useFocusEffect(load);

  const handleQuickRecord = useCallback(
    async (reminder: TodayReminder) => {
      if (saving) return;
      setSaving(reminder.id);
      try {
        await createCareLog({ plantingId: reminder.plantingId, kind: reminder.kind });
        load();
      } finally {
        setSaving(null);
      }
    },
    [saving, load],
  );

  if (reminders.length === 0) return null;

  return (
    <View style={styles.card} testID="today-reminder-card">
      <Text style={styles.title}>今日のリマインダー</Text>
      {reminders.map((reminder) => (
        <PressableScale
          key={reminder.id}
          style={styles.row}
          onPress={() =>
            router.push(`/plantings/${reminder.plantingId}/care-logs/new?kind=${reminder.kind}`)
          }
          accessibilityLabel={`${reminder.cropName}の${CARE_KIND_LABEL[reminder.kind]}を記録する`}
        >
          <Text style={[styles.time, reminder.done && styles.dimmed]}>
            {formatReminderTime(reminder.at)}
          </Text>
          <Text style={[styles.label, reminder.done && styles.dimmed]} numberOfLines={1}>
            <Text style={styles.crop}>{reminder.cropName}</Text>
            {` の${CARE_KIND_LABEL[reminder.kind]}`}
          </Text>
          {reminder.done ? (
            <View style={styles.doneBadge}>
              <Check size={12} color={Colors.accentInk} />
              <Text style={styles.doneText}>記録済み</Text>
            </View>
          ) : (
            <PressableScale
              style={styles.recordButton}
              onPress={() => void handleQuickRecord(reminder)}
              disabled={saving != null}
              hitSlop={8}
              accessibilityLabel={`${reminder.cropName}の${CARE_KIND_LABEL[reminder.kind]}を今すぐ記録`}
            >
              <Text style={styles.recordText}>{saving === reminder.id ? '記録中…' : '記録'}</Text>
            </PressableScale>
          )}
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    // 時刻の桁で行がガタつかないよう最小幅を持たせる
    minWidth: 42,
  },
  label: { flex: 1, fontSize: Typography.size.base, color: Colors.ink },
  crop: { fontWeight: Typography.weight.medium },
  dimmed: { color: Colors.inkDim },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.accentSoft,
  },
  doneText: { fontSize: Typography.size.xs, color: Colors.accentInk },
  // 塗らない（アクセント面は「つぎの作業」に譲る）。輪郭だけで押せると分かればよい
  recordButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  recordText: { fontSize: Typography.size.xs, color: Colors.accentInk, fontWeight: '600' },
});

/**
 * リマインダーの編集・削除（R11 / WBS 2.5）
 *
 * **reminderId が変わったら initialValues を null に戻してから読み直す。**
 * 作業ログの編集画面と同じ理由（そちらのコメント参照）。この画面は 2 回目以降の
 * 遷移で再マウントされず、ReminderForm も useState で初期値を受けるため、
 * 「お知らせ A を開く → 戻る → お知らせ B を開く」で B の画面に A の設定が出る。
 * 保存すると**B が A の内容で上書きされる**。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { Loading } from '../../../../../src/components/Loading';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { ReminderForm, type ReminderFormValues } from '../../../../../src/components/ReminderForm';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  deleteReminder,
  getReminder,
  updateReminder,
} from '../../../../../src/services/reminder.service';

export default function EditReminderScreen() {
  const { reminderId } = useLocalSearchParams<{ id: string; reminderId: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<ReminderFormValues | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 前のお知らせの設定を一瞬でも出さない（出すと useState がそれで固まる）
    setInitialValues(null);

    void (async () => {
      const reminder = await getReminder(reminderId);
      if (cancelled) return;
      if (!reminder) {
        router.back();
        return;
      }
      setInitialValues({
        kind: reminder.kind,
        scheduleKind: reminder.scheduleKind,
        intervalDays: reminder.intervalDays,
        weekdays: reminder.weekdays,
        hour: reminder.hour,
        minute: reminder.minute,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [reminderId, router]);

  const handleSubmit = useCallback(
    async (values: ReminderFormValues) => {
      await updateReminder(reminderId, values);
      router.back();
    },
    [reminderId, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('このお知らせを削除しますか', '通知は届かなくなります。記録は残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          void deleteReminder(reminderId).then(() => router.back());
        },
      },
    ]);
  }, [reminderId, router]);

  if (!initialValues) return <Loading />;

  return (
    <ReminderForm
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="お知らせを編集"
      footer={
        <PressableScale style={styles.deleteButton} onPress={handleDelete}>
          <Trash2 size={16} color={Colors.danger} />
          <Text style={styles.deleteText}>削除する</Text>
        </PressableScale>
      }
    />
  );
}

const styles = StyleSheet.create({
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dangerLine,
    marginTop: 8,
  },
  deleteText: { fontSize: Typography.size.base, color: Colors.danger },
});

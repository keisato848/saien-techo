/**
 * リマインダーの編集・削除（R11 / WBS 2.5）
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
    void (async () => {
      const reminder = await getReminder(reminderId);
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

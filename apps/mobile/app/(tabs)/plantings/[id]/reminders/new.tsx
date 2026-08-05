/**
 * リマインダーの追加（R11 / WBS 2.5）
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ReminderForm, type ReminderFormValues } from '../../../../../src/components/ReminderForm';
import { createReminder } from '../../../../../src/services/reminder.service';

export default function NewReminderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const handleSubmit = useCallback(
    async (values: ReminderFormValues) => {
      await createReminder({ plantingId: id, ...values });
      router.back();
    },
    [id, router],
  );

  return (
    <ReminderForm
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="お知らせを追加"
      submitLabel="追加"
    />
  );
}

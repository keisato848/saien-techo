/**
 * リマインダーの追加（R11 / WBS 2.5）
 *
 * **栽培ごとに ReminderForm を作り直す（key）。** この画面は 2 回目以降の遷移で
 * 再マウントされず、ReminderForm の useState が前回の選択を持ち越す。
 * key が無いと、別の栽培のお知らせを追加しようとしたときに前の栽培で選んだ
 * 種別・時刻が入ったまま開く（検証中に実際に見ている）。
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
      key={id}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="お知らせを追加"
      submitLabel="追加"
    />
  );
}

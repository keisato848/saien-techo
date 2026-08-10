/**
 * リマインダーの追加（R11 / WBS 2.5）
 *
 * **栽培ごとに ReminderForm を作り直す（key）。** この画面は 2 回目以降の遷移で
 * 再マウントされず、ReminderForm の useState が前回の選択を持ち越す。
 * key が無いと、別の栽培のお知らせを追加しようとしたときに前の栽培で選んだ
 * 種別・時刻が入ったまま開く（検証中に実際に見ている）。
 *
 * **残っている穴（既知・未対応）**: 同じ栽培で続けて 2 回開くと key が変わらず、
 * 前回の選択が残る。塞ぐにはフォーカスごとに作り直すか ReminderForm を
 * props 由来の値で描く形に変える必要がある。前者は入力途中に画面がブラーすると
 * 書きかけが消えるため、今の症状（新規フォームに前回の値が出る。値は画面に見えて
 * いて、既存データは壊れない）より悪い失敗になりうるので採らなかった。
 * 直すなら後者。care-logs/new.tsx も同じ種別で 2 回続けた場合に同じ穴が残る。
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

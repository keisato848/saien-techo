/**
 * 作業ログの記録（写真・メモ付き）— R04 / WBS 1.8
 *
 * 「つぎの作業」（R10 / WBS 3.4）から来たときは ?kind= で作業種別を
 * 選択済みにして開く（追肥の提案から開いたのに水やりが選ばれていると、
 * そのまま記録して履歴が濁る）。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { CareLogForm, type CareLogFormValues } from '../../../../../src/components/CareLogForm';
import { CARE_KINDS, createCareLog } from '../../../../../src/services/care-log.service';
import type { CareLogKind } from '../../../../../src/services/types';

export default function NewCareLogScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const router = useRouter();

  const initialKind =
    kind && (CARE_KINDS as readonly string[]).includes(kind) ? (kind as CareLogKind) : undefined;

  const handleSubmit = useCallback(
    async (values: CareLogFormValues) => {
      await createCareLog({
        plantingId: id,
        kind: values.kind,
        loggedAt: values.loggedAt,
        note: values.note,
        photoUris: values.photoUris,
      });
      router.back();
    },
    [id, router],
  );

  return (
    <CareLogForm
      initialValues={initialKind ? { kind: initialKind } : undefined}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="作業を記録"
      submitLabel="記録"
    />
  );
}

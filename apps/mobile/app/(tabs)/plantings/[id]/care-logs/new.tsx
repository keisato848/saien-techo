/**
 * 作業ログの記録（写真・メモ付き）— R04 / WBS 1.8
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { CareLogForm, type CareLogFormValues } from '../../../../../src/components/CareLogForm';
import { createCareLog } from '../../../../../src/services/care-log.service';

export default function NewCareLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="作業を記録"
      submitLabel="記録"
    />
  );
}

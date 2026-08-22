/**
 * 場所の新規登録（R02 / WBS 1.6）
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { PlaceForm } from '../../../src/components/PlaceForm';
import { createPlace } from '../../../src/services/place.service';
import type { PlaceFormData } from '../../../src/validation/place.schema';

export default function NewPlaceScreen() {
  const router = useRouter();

  const handleSubmit = useCallback(
    async (data: PlaceFormData) => {
      await createPlace({ name: data.name, kind: data.kind, note: data.note });
      router.back();
    },
    [router],
  );

  return (
    <PlaceForm
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="場所を追加"
      submitLabel="登録"
    />
  );
}

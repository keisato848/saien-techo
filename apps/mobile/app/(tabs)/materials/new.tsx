/**
 * 資材の新規登録（R12 / WBS 2.6）
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { MaterialForm, type MaterialFormValues } from '../../../src/components/MaterialForm';
import { createMaterial } from '../../../src/services/material.service';

export default function NewMaterialScreen() {
  const router = useRouter();

  const handleSubmit = useCallback(
    async (values: MaterialFormValues) => {
      await createMaterial({
        name: values.name,
        category: values.category,
        quantity: values.quantity,
        unit: values.unit,
        lowThreshold: values.lowThreshold,
        note: values.note,
      });
      router.back();
    },
    [router],
  );

  return (
    <MaterialForm
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="資材を追加"
      submitLabel="登録"
    />
  );
}

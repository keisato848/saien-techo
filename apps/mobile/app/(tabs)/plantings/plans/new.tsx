/**
 * 作付け計画の新規登録（R25 / WBS 4.7）
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { PlantingPlanForm } from '../../../../src/components/PlantingPlanForm';
import { createPlantingPlan } from '../../../../src/services/planting-plan.service';
import type { PlantingPlanFormData } from '../../../../src/validation/planting-plan.schema';

export default function NewPlantingPlanScreen() {
  const router = useRouter();

  const handleSubmit = useCallback(
    async (data: PlantingPlanFormData) => {
      await createPlantingPlan({
        cropName: data.cropName,
        variety: data.variety,
        placeId: data.placeId ?? null,
        plannedYear: data.plannedYear,
        plannedMonth: data.plannedMonth,
        plannedKind: data.plannedKind,
        note: data.note,
      });
      router.back();
    },
    [router],
  );

  return (
    <PlantingPlanForm
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="計画を追加"
      submitLabel="登録"
    />
  );
}

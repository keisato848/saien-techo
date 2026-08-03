/**
 * 栽培の編集（R01 / WBS 1.5）
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Loading } from '../../../../src/components/Loading';
import { PlantingForm } from '../../../../src/components/PlantingForm';
import { Toast } from '../../../../src/components/Toast';
import { Colors } from '../../../../src/constants/theme';
import { getPlantingDetail, updatePlanting } from '../../../../src/services/planting.service';
import type { PlantingFormData } from '../../../../src/validation/planting.schema';

export default function EditPlantingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<Partial<PlantingFormData> | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    void (async () => {
      const detail = await getPlantingDetail(id);
      if (!detail) {
        router.back();
        return;
      }
      setInitialValues({
        cropName: detail.cropName,
        cropNameReading: detail.cropNameReading ?? undefined,
        cropId: detail.cropId,
        variety: detail.variety ?? '',
        placeId: detail.placeId,
        plantedOn: detail.plantedOn,
        plantedAs: detail.plantedAs,
        coverPhotoPath: detail.coverPhotoUri,
        note: detail.note ?? '',
        tags: detail.tags,
      });
    })();
  }, [id, router]);

  const handleSubmit = useCallback(
    async (data: PlantingFormData) => {
      await updatePlanting(id, {
        cropName: data.cropName,
        cropNameReading: data.cropNameReading || undefined,
        cropId: data.cropId ?? null,
        variety: data.variety || undefined,
        placeId: data.placeId ?? null,
        plantedOn: data.plantedOn,
        plantedAs: data.plantedAs,
        coverPhotoPath: data.coverPhotoPath ?? null,
        note: data.note || undefined,
        tags: data.tags,
      });
      setShowToast(true);
      setTimeout(() => router.back(), 900);
    },
    [id, router],
  );

  if (!initialValues) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <PlantingForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        title="栽培を編集"
      />
      <Toast message="保存しました" visible={showToast} onDismiss={() => setShowToast(false)} />
    </View>
  );
}

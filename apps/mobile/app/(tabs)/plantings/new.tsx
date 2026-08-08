/**
 * 栽培の新規登録（R01 / WBS 1.5）
 *
 * 作物ガイド（R09 / WBS 3.3）から来たときは、クエリの
 * cropId / cropName / cropNameReading を初期値に入れて開く。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { PlantingForm } from '../../../src/components/PlantingForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { createPlanting } from '../../../src/services/planting.service';
import type { PlantingFormData } from '../../../src/validation/planting.schema';

export default function NewPlantingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    cropId?: string;
    cropName?: string;
    cropNameReading?: string;
  }>();
  const [showToast, setShowToast] = useState(false);

  const handleSubmit = useCallback(
    async (data: PlantingFormData) => {
      const id = await createPlanting({
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
      // 登録直後は詳細へ送る。続けて写真やメモを足す動線が最短になるため
      setTimeout(() => router.replace(`/plantings/${id}`), 900);
    },
    [router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <PlantingForm
        initialValues={
          params.cropName
            ? {
                cropId: params.cropId ?? null,
                cropName: params.cropName,
                cropNameReading: params.cropNameReading ?? '',
              }
            : undefined
        }
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        title="栽培を追加"
        submitLabel="登録"
      />
      <Toast
        message="栽培を登録しました"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
    </View>
  );
}

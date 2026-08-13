/**
 * 栽培の編集（R01 / WBS 1.5）
 *
 * **id が変わったら initialValues を null に戻してから読み直す。**
 * 作業ログ・お知らせの編集画面と同じ理由（そちらのコメント参照）。この画面は
 * 2 回目以降の遷移で再マウントされず、PlantingForm も useState で初期値を
 * 受けるため、「栽培 A を編集 → 戻る → 栽培 B を編集」で B の画面に A の内容が
 * 出る。保存すると**B が A の内容で上書きされる**。
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
    let cancelled = false;
    // 前の栽培の内容を一瞬でも出さない（出すと useState がそれで固まる）
    setInitialValues(null);

    void (async () => {
      const detail = await getPlantingDetail(id);
      if (cancelled) return;
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

    return () => {
      cancelled = true;
    };
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

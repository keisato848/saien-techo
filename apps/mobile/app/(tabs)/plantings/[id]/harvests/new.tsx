/**
 * 収穫の記録（R06 / WBS 2.1）
 *
 * 栽培詳細の「収穫」ボタンから来る。開いた直後にカメラが立ち上がるので、
 * 収穫 → 撮影 → 保存 の 3 タップで終わる。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { HarvestForm, type HarvestFormValues } from '../../../../../src/components/HarvestForm';
import {
  createHarvest,
  getDefaultUnitForPlanting,
} from '../../../../../src/services/harvest.service';
import type { HarvestUnit } from '../../../../../src/services/types';

export default function NewHarvestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [defaultUnit, setDefaultUnit] = useState<HarvestUnit | null>(null);
  const [ready, setReady] = useState(false);

  // 作物ごとの既定単位（R06）。トマトなら「個」を選んだ状態で開く
  useEffect(() => {
    void (async () => {
      setDefaultUnit(await getDefaultUnitForPlanting(id));
      setReady(true);
    })();
  }, [id]);

  const handleSubmit = useCallback(
    async (values: HarvestFormValues) => {
      await createHarvest({
        plantingId: id,
        harvestedAt: values.harvestedAt,
        quantity: values.quantity,
        unit: values.unit,
        note: values.note,
        photoUris: values.photoUris,
      });
      router.back();
    },
    [id, router],
  );

  // 既定単位を読むまで待つ。先に描くとカメラが二度起動する
  if (!ready) return null;

  return (
    <HarvestForm
      initialValues={{ unit: defaultUnit }}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="収穫を記録"
      submitLabel="記録"
      autoCapture
    />
  );
}

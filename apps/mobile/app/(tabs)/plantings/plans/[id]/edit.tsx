/**
 * 作付け計画の編集（R25 / WBS 4.7）
 *
 * **id が変わったら plan を null に戻してから読み直す。** 場所・作業ログ・
 * リマインダーの編集画面と同じ理由 — この画面は 2 回目以降の遷移で
 * 再マウントされず、フォームも useState で初期値を受けるため、null を
 * 挟まないと前の計画の内容が残ったまま次の計画を編集することになる。
 *
 * 削除は無条件に出す。計画は「やめた」で消えるのが自然で、記録として
 * 残す価値のあるものは変換済み（plantingId 付き）の側にあり、
 * そちらはこの画面に来ない（一覧の「植えた」から栽培へ飛ぶ）。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { Loading } from '../../../../../src/components/Loading';
import { PlantingPlanForm } from '../../../../../src/components/PlantingPlanForm';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  deletePlantingPlan,
  getPlantingPlan,
  updatePlantingPlan,
  type PlantingPlanItem,
} from '../../../../../src/services/planting-plan.service';
import type { PlantingPlanFormData } from '../../../../../src/validation/planting-plan.schema';

export default function EditPlantingPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<PlantingPlanItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);

    void (async () => {
      const detail = await getPlantingPlan(id);
      if (cancelled) return;
      if (!detail) {
        router.back();
        return;
      }
      setPlan(detail);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const handleSubmit = useCallback(
    async (data: PlantingPlanFormData) => {
      await updatePlantingPlan(id, {
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
    [id, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('この計画を消しますか', '植える前の予定なので、記録は残りません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () => {
          void deletePlantingPlan(id).then(() => router.back());
        },
      },
    ]);
  }, [id, router]);

  if (!plan) return <Loading />;

  return (
    <PlantingPlanForm
      initialValues={{
        cropName: plan.cropName,
        variety: plan.variety ?? '',
        placeId: plan.placeId,
        plannedYear: plan.plannedYear,
        plannedMonth: plan.plannedMonth,
        plannedKind: plan.plannedKind,
        note: plan.note ?? '',
      }}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="計画を編集"
      footer={
        <PressableScale style={styles.deleteButton} onPress={handleDelete}>
          <Trash2 size={16} color={Colors.danger} />
          <Text style={styles.deleteText}>消す</Text>
        </PressableScale>
      }
    />
  );
}

const styles = StyleSheet.create({
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dangerLine,
    marginTop: 8,
  },
  deleteText: { fontSize: Typography.size.base, color: Colors.danger },
});

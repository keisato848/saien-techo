/**
 * 収穫の編集・削除（R06 / WBS 2.1）
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { HarvestForm, type HarvestFormValues } from '../../../../../src/components/HarvestForm';
import { Loading } from '../../../../../src/components/Loading';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  deleteHarvest,
  getHarvest,
  updateHarvest,
} from '../../../../../src/services/harvest.service';

export default function EditHarvestScreen() {
  const { harvestId } = useLocalSearchParams<{ id: string; harvestId: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<HarvestFormValues | null>(null);

  useEffect(() => {
    void (async () => {
      const harvest = await getHarvest(harvestId);
      if (!harvest) {
        router.back();
        return;
      }
      setInitialValues({
        harvestedAt: harvest.harvestedAt,
        quantity: harvest.quantity,
        unit: harvest.unit,
        note: harvest.note ?? '',
        photoUris: harvest.photoUris,
      });
    })();
  }, [harvestId, router]);

  const handleSubmit = useCallback(
    async (values: HarvestFormValues) => {
      await updateHarvest(harvestId, {
        harvestedAt: values.harvestedAt,
        quantity: values.quantity,
        unit: values.unit,
        note: values.note,
        photoUris: values.photoUris,
      });
      router.back();
    },
    [harvestId, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('この収穫を削除しますか', '写真もまとめて消えます。元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          void deleteHarvest(harvestId).then(() => router.back());
        },
      },
    ]);
  }, [harvestId, router]);

  if (!initialValues) return <Loading />;

  return (
    <HarvestForm
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="収穫を編集"
      footer={
        <PressableScale style={styles.deleteButton} onPress={handleDelete}>
          <Trash2 size={16} color={Colors.danger} />
          <Text style={styles.deleteText}>削除する</Text>
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

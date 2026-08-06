/**
 * 資材の編集（R12 / WBS 2.6）
 *
 * 資材は他の記録から参照されないので、場所（S05）と違って常に削除できる。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { Loading } from '../../../../src/components/Loading';
import { MaterialForm, type MaterialFormValues } from '../../../../src/components/MaterialForm';
import { PressableScale } from '../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../src/constants/theme';
import {
  deleteMaterial,
  getMaterial,
  updateMaterial,
} from '../../../../src/services/material.service';
import type { MaterialItem } from '../../../../src/services/types';

export default function EditMaterialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [material, setMaterial] = useState<MaterialItem | null>(null);

  useEffect(() => {
    void (async () => {
      const item = await getMaterial(id);
      if (!item) {
        router.back();
        return;
      }
      setMaterial(item);
    })();
  }, [id, router]);

  const handleSubmit = useCallback(
    async (values: MaterialFormValues) => {
      await updateMaterial(id, {
        name: values.name,
        category: values.category,
        quantity: values.quantity,
        unit: values.unit,
        lowThreshold: values.lowThreshold,
        note: values.note,
      });
      router.back();
    },
    [id, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('この資材を削除しますか', '在庫の記録がなくなります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          void deleteMaterial(id).then(() => router.back());
        },
      },
    ]);
  }, [id, router]);

  if (!material) return <Loading />;

  return (
    <MaterialForm
      initialValues={{
        name: material.name,
        category: material.category,
        quantity: material.quantity,
        unit: material.unit ?? '',
        lowThreshold: material.lowThreshold,
        note: material.note ?? '',
      }}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="資材を編集"
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

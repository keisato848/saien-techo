/**
 * 作業ログの編集・削除 — R04 / WBS 1.8
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { CareLogForm, type CareLogFormValues } from '../../../../../src/components/CareLogForm';
import { Loading } from '../../../../../src/components/Loading';
import { PressableScale } from '../../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../../src/constants/theme';
import {
  deleteCareLog,
  getCareLog,
  updateCareLog,
} from '../../../../../src/services/care-log.service';

export default function EditCareLogScreen() {
  const { logId } = useLocalSearchParams<{ id: string; logId: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<CareLogFormValues | null>(null);

  useEffect(() => {
    void (async () => {
      const log = await getCareLog(logId);
      if (!log) {
        router.back();
        return;
      }
      setInitialValues({
        kind: log.kind,
        loggedAt: log.loggedAt,
        note: log.note ?? '',
        photoUris: log.photoUris,
      });
    })();
  }, [logId, router]);

  const handleSubmit = useCallback(
    async (values: CareLogFormValues) => {
      await updateCareLog(logId, {
        kind: values.kind,
        loggedAt: values.loggedAt,
        note: values.note,
        photoUris: values.photoUris,
      });
      router.back();
    },
    [logId, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('この記録を削除しますか', '写真もまとめて消えます。元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          void deleteCareLog(logId).then(() => router.back());
        },
      },
    ]);
  }, [logId, router]);

  if (!initialValues) return <Loading />;

  return (
    <CareLogForm
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="記録を編集"
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

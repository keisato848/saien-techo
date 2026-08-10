/**
 * 作業ログの編集・削除 — R04 / WBS 1.8
 *
 * **logId が変わったら initialValues を null に戻してから読み直す。**
 * この画面は 2 回目以降の遷移で再マウントされないため、前のログの値を
 * 持ったまま CareLogForm を描くと、useState がそれで初期化されて
 * 新しい値に入れ替わらない。「水やりの記録を開く → 戻る → 剪定の記録を開く」で
 * 剪定の画面に水やりの内容が出て、保存すると**別の記録の内容で上書きされる**
 * （実機で再現）。null を挟むと CareLogForm がいったん外れて作り直される。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
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

  // 読み直しの引き金は logId だけにする。router を依存に入れると、
  // その identity が変わるたびに下の setInitialValues(null) が走って
  // 読み込み中に戻ってしまう（値を読むだけなので ref で十分）
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let cancelled = false;
    // 前のログの内容を一瞬でも出さない（出すと useState がそれで固まる）
    setInitialValues(null);

    void (async () => {
      const log = await getCareLog(logId);
      if (cancelled) return;
      if (!log) {
        routerRef.current.back();
        return;
      }
      setInitialValues({
        kind: log.kind,
        loggedAt: log.loggedAt,
        note: log.note ?? '',
        photoUris: log.photoUris,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [logId]);

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

/**
 * 場所の編集（R02 / WBS 1.6）
 *
 * 物理削除は「まだ 1 度も使っていない場所」だけに出す。使ったことのある場所を
 * 消すと過去の栽培から場所名が失われるため、そちらは一覧の「使わない」
 * （アーカイブ）で隠す。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { Loading } from '../../../../src/components/Loading';
import { PlaceForm } from '../../../../src/components/PlaceForm';
import { PressableScale } from '../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../src/constants/theme';
import { deletePlace, getPlace, updatePlace } from '../../../../src/services/place.service';
import type { PlaceDetail } from '../../../../src/services/types';
import type { PlaceFormData } from '../../../../src/validation/place.schema';

export default function EditPlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [place, setPlace] = useState<PlaceDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const detail = await getPlace(id);
      if (!detail) {
        router.back();
        return;
      }
      setPlace(detail);
    })();
  }, [id, router]);

  const handleSubmit = useCallback(
    async (data: PlaceFormData) => {
      await updatePlace(id, { name: data.name, kind: data.kind, note: data.note });
      router.back();
    },
    [id, router],
  );

  const handleDelete = useCallback(() => {
    Alert.alert(
      'この場所を削除しますか',
      'まだ栽培に使われていないので、消しても記録は残ります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: () => {
            void deletePlace(id).then(() => router.back());
          },
        },
      ],
    );
  }, [id, router]);

  if (!place) return <Loading />;

  return (
    <PlaceForm
      initialValues={{
        name: place.name,
        kind: (place.kind ?? 'planter') as PlaceFormData['kind'],
        note: place.note ?? '',
      }}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title="場所を編集"
      footer={
        place.plantingCount === 0 ? (
          <PressableScale style={styles.deleteButton} onPress={handleDelete}>
            <Trash2 size={16} color={Colors.danger} />
            <Text style={styles.deleteText}>削除する</Text>
          </PressableScale>
        ) : (
          <Text style={styles.hint}>
            この場所は栽培 {place.plantingCount} 件で使われているため削除できません。
            使わなくなった場合は一覧の「使わない」で隠せます（記録は残ります）。
          </Text>
        )
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
  hint: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    lineHeight: 20,
    marginTop: 8,
  },
});

/**
 * 収穫の編集・削除（R06 / WBS 2.1）
 *
 * **harvestId が変わったら initialValues を null に戻してから読み直す。**
 * 作業ログ・場所・資材の編集画面と同じ理由。この画面は 2 回目以降の遷移で
 * 再マウントされず、HarvestForm も useState で初期値を受けるため、null を
 * 挟まないと前の収穫の内容が残ったまま次の収穫を編集することになる。
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
import {
  getReadDraft,
  type HarvestReadDraft,
} from '../../../../../src/services/harvest-read.service';
import { getPlantingDetail } from '../../../../../src/services/planting.service';

/**
 * 読み取りの下書きを一言にする。「直す」で来たときに**何を直すのか**が
 * 分からないと、ユーザーはゼロから入力するか、もう一度読み取って
 * 枠を消費するかしかない。
 */
function draftHint(draft: HarvestReadDraft, cropName: string | undefined): string | undefined {
  const parts: string[] = [];
  if (draft.count != null) {
    parts.push(`写真から ${draft.count} 個と読み取りました。違っていたら直してください。`);
    if (draft.cropGuess && cropName && draft.cropGuess !== cropName) {
      parts.push(`写真は「${draft.cropGuess}」に見えます。`);
    }
  }
  if (draft.readNote) parts.push(draft.readNote);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export default function EditHarvestScreen() {
  const { id, harvestId } = useLocalSearchParams<{ id: string; harvestId: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<HarvestFormValues | null>(null);
  const [cropName, setCropName] = useState<string | undefined>(undefined);
  // 文言ではなく下書きそのものを持つ。作物名は別の effect で遅れて来るので、
  // ここで文言を作ると作物の食い違いを添え損ねる
  const [draft, setDraft] = useState<HarvestReadDraft | null>(null);

  // 「写真から数量を読み取る」のヒント（#143）。取れなくても編集はできる
  useEffect(() => {
    void getPlantingDetail(id).then((planting) => setCropName(planting?.cropName));
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setInitialValues(null);
    setDraft(null);

    void (async () => {
      const harvest = await getHarvest(harvestId);
      if (cancelled) return;
      if (!harvest) {
        router.back();
        return;
      }
      // 確定していない読み取りがあれば下書きとして使う。**既に数量が入って
      // いるなら触らない** — ユーザーが確定した値のほうが強い
      const pending = harvest.quantity == null ? await getReadDraft(harvestId) : null;
      if (cancelled) return;

      setDraft(pending);
      setInitialValues({
        harvestedAt: harvest.harvestedAt,
        quantity: harvest.quantity ?? pending?.count ?? null,
        // count は個数なので、単位が空なら「個」を入れる（applyRead と同じ）
        unit: harvest.unit ?? (pending?.count != null ? 'piece' : null),
        note: harvest.note ?? '',
        photoUris: harvest.photoUris,
      });
    })();

    return () => {
      cancelled = true;
    };
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
      readCropName={cropName}
      readHint={draft ? draftHint(draft, cropName) : undefined}
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

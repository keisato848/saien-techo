/**
 * 栽培の新規登録（R01 / WBS 1.5）
 *
 * 作物ガイド（R09 / WBS 3.3）から来たときは、クエリの
 * cropId / cropName / cropNameReading を初期値に入れて開く。
 *
 * 登録が済んだら、作物ガイドから組み立てたお知らせの提案を出す
 * （R26 / WBS 4.8）。**提案が無ければ今までどおり詳細へ送る** — 提案のために
 * 1 手増やすのは、マスターに載っている作物を登録したときだけにする。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CareScheduleSheet } from '../../../src/components/CareScheduleSheet';
import { PlantingForm } from '../../../src/components/PlantingForm';
import { PressableScale } from '../../../src/components/PressableScale';
import { Toast } from '../../../src/components/Toast';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  applyCareSchedule,
  suggestCareSchedule,
  type CareScheduleSuggestion,
} from '../../../src/services/care-schedule.service';
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
  const [proposal, setProposal] = useState<{
    plantingId: string;
    cropName: string;
    suggestions: CareScheduleSuggestion[];
  } | null>(null);

  // 登録直後は詳細へ送る。続けて写真やメモを足す動線が最短になるため
  const goToDetail = useCallback(
    (plantingId: string) => router.replace(`/plantings/${plantingId}`),
    [router],
  );

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

      // **提案が取れなくても登録は成功している。** ここで投げると
      // フォームに戻され、登録し直して二重に作ってしまう
      const suggestions = await suggestCareSchedule(id).catch(() => [] as CareScheduleSuggestion[]);
      if (suggestions.length > 0) {
        // シートの中で「登録しました」と伝えるので、トーストは出さない
        setProposal({ plantingId: id, cropName: data.cropName, suggestions });
        return;
      }

      setShowToast(true);
      setTimeout(() => goToDetail(id), 900);
    },
    [goToDetail],
  );

  const applyProposal = useCallback(
    (selected: CareScheduleSuggestion[]) => {
      if (!proposal) return;
      const { plantingId } = proposal;
      // お知らせを作れなくても詳細へは進む。作れたかどうかは詳細の
      // 「お知らせ」欄を見れば分かるので、ここで足止めしない
      void applyCareSchedule(plantingId, selected)
        .catch(() => undefined)
        .then(() => {
          setProposal(null);
          goToDetail(plantingId);
        });
    },
    [proposal, goToDetail],
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
      {/* 写真からの一括登録への近道（#139 / #149）。
          作物ガイドから作物指定で来たときは、もう作物が決まっているので出さない。 */}
      {!params.cropName ? (
        <PressableScale
          style={styles.photoLink}
          onPress={() => router.replace('/plantings/identify')}
          accessibilityLabel="写真から登録する"
        >
          <Camera size={16} color={Colors.accentInk} />
          <Text style={styles.photoLinkText}>写真から登録する</Text>
        </PressableScale>
      ) : null}
      <Toast
        message="栽培を登録しました"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
      {proposal ? (
        <CareScheduleSheet
          visible
          cropName={proposal.cropName}
          suggestions={proposal.suggestions}
          onApply={applyProposal}
          onSkip={() => {
            setProposal(null);
            goToDetail(proposal.plantingId);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  photoLinkText: { fontSize: Typography.size.sm, color: Colors.accentInk },
});

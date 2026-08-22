/**
 * S17: 作物ガイド一覧 — R09 / WBS 3.3
 *
 * 30 作物を読み仮名順で。今月の「始めどき」「採りどき」を印で添える —
 * ガイドを開く動機のほとんどは「いま何が始められるか」なので、
 * 一覧の時点で今月の目星が付くようにする。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdBanner } from '../../../src/components/AdBanner';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import { getCropGuideList, type CropGuideListItem } from '../../../src/services/crop-guide.service';

export default function CropGuideListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [crops, setCrops] = useState<CropGuideListItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      // 地域を変えて戻ってきたら印を引き直す
      void getCropGuideList()
        .then(setCrops)
        .catch(() => setCrops([]));
    }, []),
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>作物ガイド</Text>
      </View>

      {crops == null ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {crops.map((crop) => (
            <PressableScale
              key={crop.cropId}
              style={styles.row}
              onPress={() => router.push(`/crops/${crop.cropId}`)}
              accessibilityLabel={`${crop.name}のガイド`}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{crop.name}</Text>
                <Text style={styles.meta}>{crop.family ?? ''}</Text>
              </View>
              {crop.startNow ? (
                <Text style={[styles.badge, styles.badgeStart]}>始めどき</Text>
              ) : null}
              {crop.harvestNow ? (
                <Text style={[styles.badge, styles.badgeHarvest]}>採りどき</Text>
              ) : null}
            </PressableScale>
          ))}
        </ScrollView>
      )}

      {/* バナーはこの閲覧型画面の下部だけ（§8.2）。広告なしビルドでは何も出ない */}
      <AdBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  rowText: { flex: 1, gap: 2 },
  name: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  badge: {
    fontSize: Typography.size.xxs,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
  },
  badgeStart: {
    color: Colors.accentInk,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  badgeHarvest: {
    color: Colors.harvest,
    borderColor: Colors.harvestLine,
    backgroundColor: Colors.harvestSoft,
  },
});

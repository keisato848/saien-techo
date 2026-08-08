/**
 * S18: 作物ガイド詳細 — R09 / WBS 3.3
 *
 * 選択地域の栽培暦（まきどき・植えどき・採りどき）と育て方、
 * 出典の一覧（判断②: 公的資料ベース）を載せる。
 * 「この作物を育てはじめる」で栽培登録へ、作物名を入れた状態で送る。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, Sprout } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import { CROP_MASTER_ATTRIBUTION, CROP_MASTER_REFERENCES } from '../../../src/db/crop-master';
import {
  formatMonthRange,
  getCropGuideDetail,
  type CropGuideDetail,
} from '../../../src/services/crop-guide.service';
import { REGION_LABEL } from '../../../src/services/region.service';

const KIND_LABEL = { sow: 'まきどき', plant: '植えどき', harvest: '採りどき' } as const;
const SUNLIGHT_LABEL = { full: '日なた', partial: '半日陰' } as const;

export default function CropGuideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<CropGuideDetail | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      void getCropGuideDetail(id)
        .then(setDetail)
        .catch(() => setDetail(null));
    }, [id]),
  );

  if (detail === undefined) return <Loading />;
  if (detail === null) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.meta}>この作物のガイドが見つかりませんでした。</Text>
      </View>
    );
  }

  const guide = detail.guide;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{detail.name}</Text>
          <Text style={styles.meta}>{detail.family ?? ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 栽培暦（選択地域） */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>栽培ごよみ</Text>
            <Pressable
              onPress={() => router.push('/region')}
              hitSlop={8}
              accessibilityLabel="地域を変更"
            >
              <Text style={styles.regionBadge}>{REGION_LABEL[detail.region]}</Text>
            </Pressable>
          </View>
          {detail.calendars.length === 0 ? (
            <Text style={styles.meta}>この地域の暦は登録されていません。</Text>
          ) : (
            detail.calendars.map((window) => (
              <View key={`${window.kind}-${window.startMonth}`} style={styles.calRow}>
                <Text style={[styles.calKind, window.kind === 'harvest' && styles.calKindHarvest]}>
                  {KIND_LABEL[window.kind]}
                </Text>
                <Text style={styles.calMonths}>
                  {formatMonthRange(window.startMonth, window.endMonth)}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* 育て方 */}
        {guide ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>育て方の目安</Text>
            <View style={styles.factsRow}>
              {guide.spacingCm != null ? (
                <Text style={styles.fact}>株間 {guide.spacingCm}cm</Text>
              ) : null}
              {guide.sunlight ? (
                <Text style={styles.fact}>{SUNLIGHT_LABEL[guide.sunlight]}</Text>
              ) : null}
              {guide.fertilizeAfterDays != null ? (
                <Text style={styles.fact}>追肥 約{guide.fertilizeAfterDays}日後</Text>
              ) : null}
              {guide.harvestAfterDays != null ? (
                <Text style={styles.fact}>収穫 約{guide.harvestAfterDays}日後</Text>
              ) : null}
            </View>
            {guide.wateringNote ? (
              <View style={styles.guideBlock}>
                <Text style={styles.guideLabel}>水やり</Text>
                <Text style={styles.guideText}>{guide.wateringNote}</Text>
              </View>
            ) : null}
            {guide.commonPests.length > 0 ? (
              <View style={styles.guideBlock}>
                <Text style={styles.guideLabel}>気をつける虫・病気</Text>
                <Text style={styles.guideText}>{guide.commonPests.join('、')}</Text>
              </View>
            ) : null}
            {guide.tips ? (
              <View style={styles.guideBlock}>
                <Text style={styles.guideLabel}>コツ</Text>
                <Text style={styles.guideText}>{guide.tips}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 栽培登録へ（R09 の導線） */}
        <PressableScale
          style={styles.startButton}
          onPress={() =>
            router.push(
              `/plantings/new?cropId=${detail.cropId}&cropName=${encodeURIComponent(
                detail.name,
              )}&cropNameReading=${encodeURIComponent(detail.nameReading ?? '')}`,
            )
          }
          accessibilityLabel="この作物を育てはじめる"
        >
          <Sprout size={18} color={Colors.onAccent} />
          <Text style={styles.startText}>この作物を育てはじめる</Text>
        </PressableScale>

        {/* 出典（判断②）。一覧はここが正で、カードの脚注は 1 行に省略している */}
        <View style={styles.sources}>
          <Text style={styles.sourcesTitle}>{CROP_MASTER_ATTRIBUTION}</Text>
          {CROP_MASTER_REFERENCES.map((ref) => (
            <Pressable
              key={ref.url}
              style={styles.sourceRow}
              onPress={() => void Linking.openURL(ref.url)}
              accessibilityLabel={`出典 ${ref.name}`}
            >
              <ExternalLink size={12} color={Colors.inkDim} />
              <Text style={styles.sourceText}>{ref.name}</Text>
            </Pressable>
          ))}
          <Text style={styles.disclaimer}>
            品種やその年の気候によって前後します。あくまで目安としてご利用ください。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  body: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  card: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
  },
  regionBadge: {
    fontSize: Typography.size.xs,
    color: Colors.accentInk,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  calRow: { flexDirection: 'row', gap: 10 },
  calKind: {
    width: 58,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
  calKindHarvest: { color: Colors.harvest },
  calMonths: { fontSize: Typography.size.sm, color: Colors.ink },
  factsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: {
    fontSize: Typography.size.xs,
    color: Colors.accentInk,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  guideBlock: { gap: 3 },
  guideLabel: { fontSize: Typography.size.xs, color: Colors.inkDim },
  guideText: { fontSize: Typography.size.sm, color: Colors.ink, lineHeight: 20 },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.accent,
  },
  startText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  sources: { gap: 6, marginTop: 4 },
  sourcesTitle: { fontSize: 10, color: Colors.inkDim },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceText: {
    flex: 1,
    fontSize: 10,
    color: Colors.inkDim,
    textDecorationLine: 'underline',
  },
  disclaimer: { fontSize: 10, color: Colors.inkDim, lineHeight: 15, marginTop: 2 },
});

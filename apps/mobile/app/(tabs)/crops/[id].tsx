/**
 * S18: 作物ガイド詳細 — R09 / WBS 3.3・4.19
 *
 * 選択地域の栽培暦（まきどき・植えどき・採りどき）と育て方、作業の目安、
 * **この作物の**出典（判断②: 公的資料ベース・4.19 で作物ごとに）を載せる。
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
import {
  CROP_MASTER_ATTRIBUTION,
  CROP_MASTER_REFERENCES,
  CROP_TASK_LABEL,
} from '../../../src/db/crop-master';
import {
  formatMonthRange,
  getCropGuideDetail,
  type CropGuideDetail,
} from '../../../src/services/crop-guide.service';
import { REGION_LABEL } from '../../../src/services/region.service';

const KIND_LABEL = { sow: 'まきどき', plant: '植えどき', harvest: '採りどき' } as const;
const SUNLIGHT_LABEL = { full: '日なた', partial: '半日陰' } as const;

/**
 * 「育て方の目安」に並べる短い札。純関数にして出し分けをテストで固定する。
 * 旧データ（4.19 の列が null）でも従来の 4 枚は出る。
 */
export function guideFacts(detail: CropGuideDetail): string[] {
  const guide = detail.guide;
  if (!guide) return [];
  const facts: string[] = [];
  if (guide.spacingCm != null) facts.push(`株間 ${guide.spacingCm}cm`);
  if (guide.sunlight) facts.push(SUNLIGHT_LABEL[guide.sunlight]);
  if (guide.germinationDays != null) facts.push(`発芽 約${guide.germinationDays}日`);
  if (guide.transplantAfterDays != null) facts.push(`定植 約${guide.transplantAfterDays}日後`);
  if (guide.fertilizeAfterDays != null) {
    facts.push(
      guide.fertilizeIntervalDays != null
        ? `追肥 約${guide.fertilizeAfterDays}日後・以後${guide.fertilizeIntervalDays}日おき`
        : `追肥 約${guide.fertilizeAfterDays}日後`,
    );
  }
  if (detail.perennial) {
    facts.push('翌年から収穫（多年草）');
  } else if (guide.harvestWindow) {
    facts.push(`収穫 約${guide.harvestWindow.min}〜${guide.harvestWindow.max}日後`);
  } else if (guide.harvestAfterDays != null) {
    facts.push(`収穫 約${guide.harvestAfterDays}日後`);
  }
  if (guide.harvestDurationDays != null) facts.push(`採れる期間 約${guide.harvestDurationDays}日`);
  if (guide.temperature) {
    const [g0, g1] = guide.temperature.germination;
    const [t0, t1] = guide.temperature.growth;
    facts.push(`発芽 ${g0}〜${g1}℃・生育 ${t0}〜${t1}℃`);
  }
  if (guide.rotationYears != null) {
    facts.push(guide.rotationYears === 0 ? '連作OK' : `連作は${guide.rotationYears}年あける`);
  }
  if (guide.wateringIntervalDays != null) facts.push(`水やり ${guide.wateringIntervalDays}日おき`);
  if (detail.editorial) {
    if (detail.editorial.beginner) facts.push('初心者向け');
    facts.push(
      detail.editorial.containerOk
        ? `プランター 深さ${detail.editorial.containerDepthCm ?? 20}cm〜`
        : 'プランター不向き',
    );
  }
  return facts;
}

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
  const facts = guideFacts(detail);
  const references =
    detail.references && detail.references.length > 0
      ? detail.references
      : [...CROP_MASTER_REFERENCES];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{detail.name}</Text>
          <Text style={styles.meta}>
            {[detail.family ?? '', detail.perennial ? '多年草' : ''].filter(Boolean).join('・')}
          </Text>
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
              {facts.map((fact) => (
                <Text key={fact} style={styles.fact}>
                  {fact}
                </Text>
              ))}
            </View>
            {guide.wateringNote ? (
              <View style={styles.guideBlock}>
                <Text style={styles.guideLabel}>水やり</Text>
                <Text style={styles.guideText}>{guide.wateringNote}</Text>
              </View>
            ) : null}
            {guide.tasks.length > 0 ? (
              <View style={styles.guideBlock}>
                <Text style={styles.guideLabel}>作業の目安</Text>
                {guide.tasks.map((task) => (
                  <Text key={`${task.kind}-${task.afterDays}`} style={styles.guideText}>
                    {CROP_TASK_LABEL[task.kind]} 約{task.afterDays}日後
                    {task.note ? `（${task.note}）` : ''}
                  </Text>
                ))}
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

        {/* 出典（判断②）。4.19 からこの作物の分だけ。カードの脚注は 1 行に省略している */}
        <View style={styles.sources}>
          <Text style={styles.sourcesTitle}>{CROP_MASTER_ATTRIBUTION}</Text>
          {references.map((ref) => (
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
  // 札が 2 行以上に折り返す（4.19 で 10 枚前後になった）。`gap` だけだと Yoga が折り返し後の高さを
  // 取り違え、次の見出しと重なった上に 2 行目以降の札が縦に伸びた（実機 2026-09-06）。
  // 行間・列間を分けて指定し、札を上寄せにする
  factsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    rowGap: 8,
    columnGap: 8,
  },
  fact: {
    fontSize: Typography.size.xs,
    color: Colors.accentInk,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    alignSelf: 'flex-start',
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

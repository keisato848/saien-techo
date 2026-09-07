/**
 * S04b: 収穫のふりかえり（年間サマリー）— R18 / WBS 4.6（#32）
 *
 * 収穫アルバムの相方。アルバムが「写真を見返す」なら、こちらは
 * **「今年どれだけ採れたか」を数で見返す**画面。
 *
 * ## 数量ではなく「回数」を主役にした理由
 *
 * 数量は任意入力（R06）で、写真だけの収穫が普通にある。合計を主役にすると
 * ほとんどの利用者の画面が空になる。**回数なら必ず数えられる**ので、
 * 見出しの大きな数字は「N 回採れました」。数量はそのうえに重ねて、
 * 「数量のある N 件だけ合計しています」と必ず断る。
 *
 * ## グラフを描くライブラリは入れない
 *
 * 依存を増やさない方針なので、月別の帯は View の高さで描いている。
 * 目盛りも軸も無い — 形（いつ採れたか）が分かればよく、正確な値は
 * 数字で併記してある。読み上げのために各月に accessibilityLabel を付ける。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  getHarvestYears,
  getHarvestYearSummary,
  type HarvestCropStat,
  type HarvestYearSummary,
} from '../../../src/services/harvest-stats.service';
import { HARVEST_UNIT_LABEL } from '../../../src/services/harvest.service';

/** 帯のいちばん高い月の高さ。これ以上高くすると 1 画面に収まらない */
const BAR_MAX_HEIGHT = 72;
const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

function formatMonthDay(iso: string): string {
  const at = new Date(iso);
  return `${at.getMonth() + 1}月${at.getDate()}日`;
}

function formatShortDay(iso: string): string {
  const at = new Date(iso);
  return `${at.getMonth() + 1}/${at.getDate()}`;
}

/** 「12個」「1.5kg」。単位をまたいで足せないので、並べて出す */
function formatTotals(crop: HarvestCropStat): string | null {
  if (crop.totals.length === 0) return null;
  return crop.totals
    .map((total) => `${total.quantity}${HARVEST_UNIT_LABEL[total.unit]}`)
    .join('　');
}

/**
 * 数量の但し書き。**ここを省くと「3 個しか採れなかった」と読まれる**
 * （実際は数量を入れた 1 件だけの合計かもしれない）。
 */
function quantityNote(summary: HarvestYearSummary): string {
  if (summary.quantifiedCount === 0) {
    return '数量を入れた収穫はまだありません。ここでは採れた回数を数えています。';
  }
  const withoutQuantity = summary.count - summary.quantifiedCount;
  if (withoutQuantity === 0) return 'すべての収穫に数量が入っています。';
  return `数量のある${summary.quantifiedCount}件だけ合計しています（残り${withoutQuantity}件は写真だけの記録です）。`;
}

export default function HarvestStatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [summary, setSummary] = useState<HarvestYearSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const list = await getHarvestYears();
        setYears(list);
        // 選択中の年が消えた（その年の収穫を全部消した）ときは選び直す。
        // 既定は「今年」だが、今年まだ採れていないなら直近の年を開く —
        // 初年度の 1 月に開いて空の今年が出るより、去年の実りが見えるほうがよい
        setYear((current) => {
          if (current != null && list.includes(current)) return current;
          const thisYear = new Date().getFullYear();
          return list.includes(thisYear) ? thisYear : (list[0] ?? null);
        });
        if (list.length === 0) setLoading(false);
      })();
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (year == null) return;
      void (async () => {
        setSummary(await getHarvestYearSummary(year));
        setLoading(false);
      })();
    }, [year]),
  );

  const maxMonthCount = summary ? Math.max(...summary.months.map((m) => m.count), 1) : 1;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <PressableScale onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={24} color={Colors.ink} />
        </PressableScale>
        <Text style={styles.headerTitle}>収穫のふりかえり</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* 年が 2 つ以上あるときだけ切り替えを出す。初年度に「2026年」だけの
          チップが並んでも選ぶものが無い */}
      {years.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // 横スクロール帯は縦にも伸びようとするので止める（アルバムと同じ）
          style={styles.yearsScroll}
          contentContainerStyle={styles.years}
        >
          {years.map((value) => {
            const active = value === year;
            return (
              <PressableScale
                key={value}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  if (active) return;
                  setLoading(true);
                  setYear(value);
                }}
                accessibilityLabel={`${value}年`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{value}年</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}

      {loading ? (
        <Loading />
      ) : years.length === 0 ? (
        <EmptyState
          icon="🧺"
          title="まだ収穫がありません"
          message="栽培を開いて「収穫した」から記録すると、ここに 1 年の実りがたまります。"
        />
      ) : summary == null || summary.count === 0 ? (
        <EmptyState
          icon="🌱"
          title={`${year}年の収穫はまだありません`}
          message="採れたら記録してみてください。数量は入れなくても大丈夫です。"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* 数字と単位を分けて描くと読み上げが「7」「回」と切れるので、
              まとまりの読み上げ文をブロックに持たせる */}
          <View
            style={styles.hero}
            accessibilityLabel={`${summary.year}年に${summary.count}回採れました`}
          >
            <View style={styles.heroCountRow}>
              <Text style={styles.heroCount}>{summary.count}</Text>
              <Text style={styles.heroUnit}>回</Text>
            </View>
            <Text style={styles.heroCaption}>{summary.year}年に採れました</Text>
            <Text style={styles.heroMeta}>
              {`${summary.cropCount}種類　写真${summary.photoCount}枚`}
            </Text>
            {summary.firstHarvest ? (
              <Text style={styles.heroFirst}>
                {`初収穫は${formatMonthDay(summary.firstHarvest.harvestedAt)}の${summary.firstHarvest.cropName}`}
              </Text>
            ) : null}
          </View>

          <Text style={styles.note}>{quantityNote(summary)}</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>月ごとの収穫</Text>
            <View style={styles.chart}>
              {summary.months.map((month) => (
                <View
                  key={month.month}
                  style={styles.chartColumn}
                  accessibilityLabel={`${month.month}月 ${month.count}回`}
                >
                  <Text style={styles.chartValue}>{month.count > 0 ? month.count : ''}</Text>
                  <View style={styles.chartBarTrack}>
                    <View
                      style={[
                        styles.chartBar,
                        {
                          // 0 の月は棒を描かない（1px の線が残ると「少し採れた」に見える）
                          height:
                            month.count === 0
                              ? 0
                              : Math.max(
                                  4,
                                  Math.round((month.count / maxMonthCount) * BAR_MAX_HEIGHT),
                                ),
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.chartLabel}>{MONTH_LABELS[month.month - 1]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>作物ランキング</Text>
            {summary.crops.map((crop, index) => {
              const totals = formatTotals(crop);
              return (
                <View
                  key={crop.cropName}
                  style={styles.cropRow}
                  accessibilityLabel={`${index + 1}位 ${crop.cropName} ${crop.count}回`}
                >
                  <Text style={styles.cropRank}>{index + 1}</Text>
                  {crop.photoUri ? (
                    <Image source={{ uri: crop.photoUri }} style={styles.cropPhoto} />
                  ) : (
                    <View style={[styles.cropPhoto, styles.cropPhotoEmpty]} />
                  )}
                  <View style={styles.cropBody}>
                    <View style={styles.cropTitleRow}>
                      <Text style={styles.cropName} numberOfLines={1}>
                        {crop.cropName}
                      </Text>
                      <Text style={styles.cropCount}>{crop.count}回</Text>
                    </View>
                    <Text style={styles.cropMeta} numberOfLines={1}>
                      {`${totals ?? '数量の記録なし'}　初収穫 ${formatShortDay(crop.firstHarvestedAt)}`}
                    </Text>
                    {/* 作物ごとの「いつ採れたか」。12 マスで 1〜12 月 */}
                    <View
                      style={styles.strip}
                      accessibilityLabel={`${crop.cropName}を収穫した月: ${crop.monthCounts
                        .map((count, i) => (count > 0 ? `${i + 1}月` : null))
                        .filter(Boolean)
                        .join('・')}`}
                    >
                      {crop.monthCounts.map((count, monthIndex) => (
                        <View
                          key={monthIndex}
                          style={[styles.stripCell, count > 0 && styles.stripCellOn]}
                        />
                      ))}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {summary.highlights.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>この年の写真</Text>
              <Text style={styles.sectionCaption}>月ごとに 1 枚ずつ選んでいます。</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.highlightsScroll}
                contentContainerStyle={styles.highlights}
              >
                {summary.highlights.map((highlight) => (
                  <PressableScale
                    key={highlight.harvestId}
                    onPress={() =>
                      router.push(
                        `/plantings/${highlight.plantingId}/harvests/${highlight.harvestId}`,
                      )
                    }
                    accessibilityLabel={`${formatShortDay(highlight.harvestedAt)}の${highlight.cropName}`}
                  >
                    <Image source={{ uri: highlight.photoUri }} style={styles.highlightPhoto} />
                    <Text style={styles.highlightLabel} numberOfLines={1}>
                      {`${formatShortDay(highlight.harvestedAt)} ${highlight.cropName}`}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </ScrollView>
      )}
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
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerSpacer: { flex: 1 },
  yearsScroll: { flexGrow: 0, flexShrink: 0 },
  years: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.harvest, backgroundColor: Colors.harvestSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.harvest, fontWeight: Typography.weight.medium },
  body: { paddingHorizontal: 16, paddingBottom: 40, gap: 20 },

  hero: {
    backgroundColor: Colors.harvestSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.harvestLine,
    padding: 16,
    gap: 2,
  },
  heroCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  heroCount: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    color: Colors.harvest,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.harvest,
  },
  heroCaption: { fontSize: Typography.size.base, color: Colors.ink },
  heroMeta: { fontSize: Typography.size.sm, color: Colors.inkDim, marginTop: 6 },
  heroFirst: { fontSize: Typography.size.sm, color: Colors.inkDim },
  note: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18 },

  section: { gap: 10 },
  sectionTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  sectionCaption: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: -6 },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  chartColumn: { flex: 1, alignItems: 'center', gap: 3 },
  chartValue: {
    fontSize: Typography.size.xxs,
    color: Colors.inkDim,
    fontVariant: ['tabular-nums'],
  },
  chartBarTrack: { height: BAR_MAX_HEIGHT, justifyContent: 'flex-end', width: '100%' },
  chartBar: { width: '100%', borderRadius: 3, backgroundColor: Colors.harvest },
  chartLabel: { fontSize: Typography.size.xxs, color: Colors.inkDim },

  cropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 10,
  },
  cropRank: {
    width: 16,
    textAlign: 'center',
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.inkDim,
    fontVariant: ['tabular-nums'],
  },
  cropPhoto: { width: 44, height: 44, borderRadius: 8, backgroundColor: Colors.surfaceInput },
  cropPhotoEmpty: { backgroundColor: Colors.harvestSoft },
  cropBody: { flex: 1, gap: 4 },
  cropTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  cropName: { flex: 1, fontSize: Typography.size.base, color: Colors.ink },
  cropCount: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.harvest,
    fontVariant: ['tabular-nums'],
  },
  cropMeta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  strip: { flexDirection: 'row', gap: 2, marginTop: 2 },
  stripCell: { flex: 1, height: 5, borderRadius: 2, backgroundColor: Colors.surfaceInput },
  stripCellOn: { backgroundColor: Colors.harvest },

  highlightsScroll: { flexGrow: 0, flexShrink: 0 },
  highlights: { gap: 10, paddingRight: 4 },
  highlightPhoto: { width: 96, height: 96, borderRadius: 10, backgroundColor: Colors.surfaceInput },
  highlightLabel: {
    width: 96,
    marginTop: 4,
    fontSize: Typography.size.xxs,
    color: Colors.inkDim,
  },
});

/**
 * カレンダー — R05 / WBS 2.3
 *
 * 作業ログと収穫を月グリッドで見る。だいどこの調理記録カレンダーを
 * 菜園の記録に書き換えたもの（升目づくりは utils/monthMatrix.ts で共通）。
 *
 * **点は「作業」「収穫」の 2 色だけ。** 作業種別ごとに 6 色を割り当てる案もあったが、
 * 1 マスが 40px 前後しかなく、色を増やすと何色なのか判別できない。
 * 栽培の件数を点の数で表す案も試したが、凡例の「緑=作業 / 橙=収穫」と衝突して
 * 読めなくなった（実機で確認）。種別は日を選んだときの一覧で読める。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from '../src/components/Loading';
import { PressableScale } from '../src/components/PressableScale';
import { Colors, Typography } from '../src/constants/theme';
import { CARE_KIND_LABEL } from '../src/services/care-log.service';
import { getTimeline } from '../src/services/garden-timeline.service';
import { HARVEST_UNIT_LABEL } from '../src/services/harvest.service';
import type { GardenTimelineEntry } from '../src/services/types';
import { groupGardenEntriesByDay } from '../src/utils/gardenCalendar';
import { buildMonthMatrix, localDayKey, WEEKDAY_LABELS } from '../src/utils/monthMatrix';

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [entries, setEntries] = useState<GardenTimelineEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // 表示中の月だけ引く。全期間を引くと記録が増えたときに開くのが遅くなる
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
    setEntries(await getTimeline({ from, to }));
    setLoading(false);
  }, [year, month]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const weeks = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const byDay = useMemo(() => groupGardenEntriesByDay(entries), [entries]);
  const todayKey = localDayKey(today);
  const selectedEntries = selected ? (byDay.get(selected)?.entries ?? []) : [];

  const shift = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setLoading(true);
    setSelected(null);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.inkDim} />
        </Pressable>
        <Text style={styles.title}>カレンダー</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.monthBar}>
        <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityLabel="前の月">
          <ChevronLeft size={22} color={Colors.accent} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {year}年{month + 1}月
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityLabel="次の月">
          <ChevronRight size={22} color={Colors.accent} />
        </Pressable>
      </View>

      <View style={styles.weekdays}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.grid}>
            {weeks.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.week}>
                {week.map((cell) => {
                  const summary = cell.inMonth ? byDay.get(cell.key) : undefined;
                  const isSelected = selected === cell.key;
                  return (
                    <Pressable
                      key={cell.key}
                      style={styles.cell}
                      disabled={!summary}
                      onPress={() => setSelected(isSelected ? null : cell.key)}
                      accessibilityLabel={`${cell.day}日${summary ? `　記録 ${summary.entries.length} 件` : ''}`}
                    >
                      <View
                        style={[
                          styles.dayCircle,
                          cell.key === todayKey && styles.dayToday,
                          isSelected && styles.daySelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            !cell.inMonth && styles.dayOutside,
                            isSelected && styles.dayTextSelected,
                          ]}
                        >
                          {cell.day}
                        </Text>
                      </View>
                      <View style={styles.dots}>
                        {summary?.hasCareLog ? <View style={styles.dot} /> : null}
                        {summary?.hasHarvest ? (
                          <View style={[styles.dot, styles.dotHarvest]} />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={styles.dot} />
              <Text style={styles.legendText}>作業</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.dot, styles.dotHarvest]} />
              <Text style={styles.legendText}>収穫</Text>
            </View>
          </View>

          {selected ? (
            <View style={styles.detail}>
              <Text style={styles.detailLabel}>
                {Number(selected.split('-')[1])}月{Number(selected.split('-')[2])}日
              </Text>
              {selectedEntries.map((entry) => (
                <PressableScale
                  key={entry.id}
                  style={styles.entry}
                  onPress={() =>
                    router.push(
                      entry.type === 'harvest'
                        ? `/plantings/${entry.plantingId}/harvests/${entry.id}`
                        : `/plantings/${entry.plantingId}/care-logs/${entry.id}`,
                    )
                  }
                >
                  <View style={[styles.dot, entry.type === 'harvest' && styles.dotHarvest]} />
                  <View style={styles.entryBody}>
                    <Text style={styles.entryTitle}>
                      <Text style={styles.entryCrop}>{entry.cropName}</Text>
                      {'　'}
                      {entry.type === 'harvest'
                        ? entry.quantity != null && entry.unit
                          ? `収穫 ${entry.quantity}${HARVEST_UNIT_LABEL[entry.unit]}`
                          : '収穫'
                        : entry.kind
                          ? CARE_KIND_LABEL[entry.kind]
                          : ''}
                    </Text>
                    {entry.note ? (
                      <Text style={styles.entryNote} numberOfLines={2}>
                        {entry.note}
                      </Text>
                    ) : null}
                  </View>
                  {entry.photoUris.length > 0 ? (
                    <Image source={{ uri: entry.photoUris[0] }} style={styles.entryPhoto} />
                  ) : null}
                </PressableScale>
              ))}
            </View>
          ) : entries.length === 0 ? (
            <Text style={styles.empty}>この月の記録はありません。</Text>
          ) : (
            <Text style={styles.empty}>日付を選ぶと、その日の記録が出ます。</Text>
          )}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerSpacer: { width: 20 },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 12,
  },
  monthLabel: {
    fontSize: Typography.size.md,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
    minWidth: 128,
    textAlign: 'center',
  },
  weekdays: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6 },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
  },
  body: { paddingBottom: 40 },
  grid: { paddingHorizontal: 12 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 5, gap: 4 },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 丸めを条件側にも持たせている。dayCircle 側だけに borderRadius を置くと、
  // 選択日が Android で角丸の効かない四角に出た（実機で確認）。
  // 同じ形（素のスタイルに borderRadius、条件側で背景色）でも正しく丸まる箇所が
  // あり原因は特定できていないため、確実な側に倒している。
  dayToday: { borderRadius: 16, borderWidth: 1, borderColor: Colors.accentLine },
  daySelected: { borderRadius: 16, backgroundColor: Colors.accent },
  dayText: {
    fontSize: Typography.size.sm,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  dayOutside: { color: Colors.line },
  dayTextSelected: { color: Colors.onAccent, fontWeight: Typography.weight.semibold },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  dotHarvest: { backgroundColor: Colors.harvest },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  detail: { paddingHorizontal: 16, paddingTop: 20, gap: 8 },
  detailLabel: { fontSize: Typography.size.sm, color: Colors.inkDim },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  entryBody: { flex: 1, gap: 4 },
  entryTitle: { fontSize: Typography.size.base, color: Colors.inkDim },
  entryCrop: { color: Colors.ink, fontWeight: Typography.weight.medium },
  entryNote: { fontSize: Typography.size.sm, color: Colors.inkDim },
  entryPhoto: { width: 44, height: 44, borderRadius: 8, backgroundColor: Colors.surfaceInput },
  empty: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    textAlign: 'center',
    paddingTop: 28,
  },
});

/**
 * S01: ホーム — 今日の菜園（R05 / WBS 1.9、統合は WBS 3.5）
 *
 * だいどこの調理記録タイムラインを、栽培の作業ログのタイムラインに差し替えた。
 *
 * ## カードの並び（WBS 3.5 で確定）
 *
 * 1. 今日のリマインダー（R11）— 自分で決めた予定。事実
 * 2. つぎの作業（R10）— アプリからの提案。ホームで唯一のアクセント面
 * 3. 育てているもの — 自分の畑への入口
 * 4. 今月の菜園仕事（R08）— 季節の情報
 * 5. さいきんの記録（R05）— 履歴
 *
 * 「予定 → 提案 → 自分の畑 → 季節 → 履歴」。1・2 はどちらも行動を促すが、
 * 自分で設定した予定の方が確度が高いので上に置く。
 * 1〜2・4 は中身が無ければカードごと消えるので、多くの日は 2 枚程度に収まる。
 *
 * ## 栽培 0 件のとき（WBS 3.5 で判断）
 *
 * 「ようこそ」だけでなく**「今月の菜園仕事」も出す**。まだ何も植えていない人に
 * とって「今月なにを植えられるか」は最も役に立つ情報で、すでに実装がある。
 * ここを空にすると、登録するまで何も分からない行き止まりになる。
 * docs/画面設計.md S01 参照。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { CalendarDays, Images, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../src/components/EmptyState';
import { Loading } from '../../src/components/Loading';
import { MonthlyWorkCard } from '../../src/components/MonthlyWorkCard';
import { NextActionCard } from '../../src/components/NextActionCard';
import { PressableScale } from '../../src/components/PressableScale';
import { HarvestReadCard } from '../../src/components/HarvestReadCard';
import { TodayReminderCard } from '../../src/components/TodayReminderCard';
import { Colors, Typography } from '../../src/constants/theme';
import { CARE_KIND_LABEL } from '../../src/services/care-log.service';
import { HARVEST_UNIT_LABEL } from '../../src/services/harvest.service';
import {
  getTimeline,
  groupByDay,
  type TimelineDay,
} from '../../src/services/garden-timeline.service';
import { getPlantingList } from '../../src/services/planting.service';
import type { PlantingListItem } from '../../src/services/types';

/** ホームに出す件数。多すぎると「今日の菜園」ではなくなる */
const TIMELINE_LIMIT = 30;

/**
 * 日付見出し。菜園では「何日前にやったか」が知りたい情報なので、
 * 直近 1 週間は相対表記にする。
 *
 * 7 日目を含めるのは、記録フォームの「1週間前」チップ（DateField の
 * quickPicks）がちょうど 7 日前を作るため。ここを 7 未満にすると、
 * 「1週間前」で入れた記録の見出しだけ「8月3日」と絶対表記になり、
 * 押した言葉と見出しが対応しなくなる。
 */
export function formatDayLabel(date: string, now = new Date()): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return '今日';
  if (diffDays === 1) return 'きのう';
  if (diffDays > 1 && diffDays <= 7) return `${diffDays}日前`;
  return `${month}月${day}日`;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [growing, setGrowing] = useState<PlantingListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [entries, plantings] = await Promise.all([
      getTimeline({ limit: TIMELINE_LIMIT }),
      getPlantingList(),
    ]);
    setDays(groupByDay(entries));
    setGrowing(plantings);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) return <Loading />;

  const hasAnything = growing.length > 0 || days.length > 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>今日の菜園</Text>
        {/* カレンダーと写真は「振り返る」ための画面。毎日使うものではないので
            タブには出さず、ホームの右上から開く（R05 / WBS 2.3） */}
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/calendar')}
            hitSlop={10}
            accessibilityLabel="カレンダーを開く"
          >
            <CalendarDays size={20} color={Colors.inkDim} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/gallery')}
            hitSlop={10}
            accessibilityLabel="写真を開く"
          >
            <Images size={20} color={Colors.inkDim} />
          </Pressable>
        </View>
      </View>

      {!hasAnything ? (
        // 何も無い人にも「今月の菜園仕事」は出す。まだ植えていない人にとって
        // 「今月なにを植えられるか」が一番の手がかりになるため（WBS 3.5）
        <ScrollView contentContainerStyle={styles.body}>
          <EmptyState
            icon="🌱"
            title="さいえん手帳へようこそ"
            message="育てているものを登録すると、経過日数と作業の記録がここに並びます。"
            actionLabel="栽培を追加"
            onAction={() => router.push('/plantings/new')}
          />
          <MonthlyWorkCard />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* 撮り溜めの回収 → 予定 → 提案 の順。読み取りは帰宅直後の一手なので最上段 */}
          <HarvestReadCard />
          <TodayReminderCard />
          <NextActionCard />

          {growing.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>育てているもの</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.growingRow}
              >
                {growing.map((planting) => (
                  <PressableScale
                    key={planting.id}
                    style={styles.growingCard}
                    onPress={() => router.push(`/plantings/${planting.id}`)}
                  >
                    {planting.coverPhotoUri ? (
                      <Image source={{ uri: planting.coverPhotoUri }} style={styles.growingThumb} />
                    ) : (
                      <View style={[styles.growingThumb, styles.growingThumbPlaceholder]}>
                        <Text style={styles.growingEmoji}>🌱</Text>
                      </View>
                    )}
                    <Text style={styles.growingName} numberOfLines={1}>
                      {planting.cropName}
                    </Text>
                    <Text style={styles.growingDays}>{planting.elapsedDays}日目</Text>
                  </PressableScale>
                ))}
                <PressableScale
                  style={[styles.growingCard, styles.growingAdd]}
                  onPress={() => router.push('/plantings/new')}
                  accessibilityLabel="栽培を追加"
                >
                  <Plus size={22} color={Colors.accent} />
                  <Text style={styles.growingAddText}>追加</Text>
                </PressableScale>
              </ScrollView>
            </View>
          ) : null}

          {/* 今月の菜園仕事（R08 / WBS 3.2）。栽培暦 × 地域帯 */}
          <MonthlyWorkCard />

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>さいきんの記録</Text>
            {days.length === 0 ? (
              <Text style={styles.empty}>
                まだ作業の記録がありません。栽培を開いて「やった！」から記録できます。
              </Text>
            ) : (
              days.map((day) => (
                <View key={day.date} style={styles.day}>
                  <Text style={styles.dayLabel}>{formatDayLabel(day.date)}</Text>
                  {day.entries.map((entry) => (
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
                      {/* 収穫は暖色のドットで作業ログと区別する（docs/画面設計.md S01） */}
                      <View
                        style={[
                          styles.entryDot,
                          entry.type === 'harvest' && styles.entryDotHarvest,
                        ]}
                      />
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
                        {entry.photoUris.length > 0 ? (
                          <View style={styles.entryPhotos}>
                            {entry.photoUris.slice(0, 4).map((uri) => (
                              <Image key={uri} source={{ uri }} style={styles.entryPhoto} />
                            ))}
                            {entry.photoUris.length > 4 ? (
                              <Text style={styles.entryPhotoMore}>
                                +{entry.photoUris.length - 4}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    </PressableScale>
                  ))}
                </View>
              ))
            )}
          </View>
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
  headerActions: { flexDirection: 'row', gap: 18 },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  body: { paddingBottom: 32, gap: 24 },
  section: { gap: 10 },
  sectionLabel: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    paddingHorizontal: 16,
  },
  growingRow: { paddingHorizontal: 16, gap: 10 },
  growingCard: {
    width: 92,
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  growingThumb: { width: 64, height: 64, borderRadius: 10 },
  growingThumbPlaceholder: {
    backgroundColor: Colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  growingEmoji: { fontSize: 26 },
  growingName: { fontSize: Typography.size.sm, color: Colors.ink },
  growingDays: {
    fontSize: Typography.size.xs,
    color: Colors.accent,
    fontVariant: ['tabular-nums'],
  },
  growingAdd: {
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
    borderStyle: 'dashed',
  },
  growingAddText: { fontSize: Typography.size.xs, color: Colors.accent },
  empty: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  day: { gap: 8, paddingHorizontal: 16, marginBottom: 6 },
  dayLabel: {
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    fontWeight: Typography.weight.medium,
    marginTop: 6,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  entryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    marginTop: 6,
  },
  entryDotHarvest: { backgroundColor: Colors.harvest },
  entryBody: { flex: 1, gap: 6 },
  entryTitle: { fontSize: Typography.size.base, color: Colors.inkDim },
  entryCrop: { color: Colors.ink, fontWeight: Typography.weight.medium },
  entryNote: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 19 },
  entryPhotos: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  entryPhoto: { width: 52, height: 52, borderRadius: 6, backgroundColor: Colors.surfaceInput },
  entryPhotoMore: { fontSize: Typography.size.xs, color: Colors.inkDim },
});

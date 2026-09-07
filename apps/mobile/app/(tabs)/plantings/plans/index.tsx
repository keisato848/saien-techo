/**
 * S: 作付け計画の一覧（R25 / WBS 4.7・#38）
 *
 * 「これから」と「植えた」の 2 つだけ。予定の近い順に並べ、時期が来たものには
 * 「栽培にする」を出す。**これが R25 のワンタップ変換**で、押すと計画の内容を
 * 引き継いだ栽培ができ、その栽培の詳細へ移る。
 *
 * 変換は取り消しにくい（栽培が 1 件できる）ので、押す前に何ができるかを
 * 確認シートで見せる。それでも「1 タップ + 確認」で済むようにしていて、
 * 栽培の登録フォームは通さない — 計画に作物・場所・品種が既に入っている以上、
 * 同じことをもう一度入力させる意味がないため。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus, Sprout } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { EmptyState } from '../../../../src/components/EmptyState';
import { Loading } from '../../../../src/components/Loading';
import { PressableScale } from '../../../../src/components/PressableScale';
import { Toast } from '../../../../src/components/Toast';
import { Colors, Typography } from '../../../../src/constants/theme';
import {
  convertPlanToPlanting,
  formatPlannedMonth,
  getPlantingPlans,
  planTiming,
  planTimingLabel,
  PLAN_KIND_LABEL,
  type PlantingPlanItem,
} from '../../../../src/services/planting-plan.service';

type Tab = 'planned' | 'converted';

export default function PlantingPlanListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('planned');
  const [plans, setPlans] = useState<PlantingPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<PlantingPlanItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPlans(await getPlantingPlans({ onlyConverted: tab === 'converted' }));
    setLoading(false);
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleConvert = useCallback(async () => {
    const plan = converting;
    setConverting(null);
    if (!plan) return;
    const plantingId = await convertPlanToPlanting(plan.id);
    setToast(`${plan.cropName}の栽培を登録しました`);
    // 登録直後は栽培の詳細へ。写真やメモを続けて足す動線が最短になる
    // （plantings/new.tsx の登録後と同じ扱い）
    setTimeout(() => router.push(`/plantings/${plantingId}`), 900);
  }, [converting, router]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>作付け計画</Text>
        <PressableScale
          style={styles.addButton}
          onPress={() => router.push('/plantings/plans/new')}
          accessibilityLabel="計画を追加"
        >
          <Plus size={18} color={Colors.onAccent} />
        </PressableScale>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['planned', 'これから'],
            ['converted', '植えた'],
          ] as [Tab, string][]
        ).map(([key, label]) => {
          const active = tab === key;
          return (
            <PressableScale
              key={key}
              style={[styles.tabChip, active && styles.tabChipActive]}
              onPress={() => {
                setLoading(true);
                setTab(key);
              }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </PressableScale>
          );
        })}
      </View>

      {loading ? (
        <Loading />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={tab === 'planned' ? '🗓️' : '🌱'}
          title={tab === 'planned' ? 'まだ計画がありません' : 'まだ植えた計画はありません'}
          message={
            tab === 'planned'
              ? '「来年の春はソラマメ」のように、植えたいものと時期を先に決めておけます。時期が来たら 1 タップで栽培にできます。'
              : '計画を栽培にすると、こちらに残ります。'
          }
          actionLabel={tab === 'planned' ? '計画を追加' : undefined}
          onAction={tab === 'planned' ? () => router.push('/plantings/plans/new') : undefined}
        />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const timing = planTiming(item.monthsUntil);
            return (
              <View style={styles.card}>
                <PressableScale
                  style={styles.cardMain}
                  onPress={() =>
                    item.plantingId
                      ? router.push(`/plantings/${item.plantingId}`)
                      : router.push(`/plantings/plans/${item.id}/edit`)
                  }
                >
                  <View style={styles.cardBody}>
                    <Text style={styles.cropName} numberOfLines={1}>
                      {item.cropName}
                      {item.variety ? <Text style={styles.variety}>　{item.variety}</Text> : null}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {[
                        `${formatPlannedMonth(item.plannedYear, item.plannedMonth)}に${
                          PLAN_KIND_LABEL[item.plannedKind]
                        }`,
                        item.placeName,
                      ]
                        .filter(Boolean)
                        .join(' ・ ')}
                    </Text>
                    {item.note ? (
                      <Text style={styles.note} numberOfLines={2}>
                        {item.note}
                      </Text>
                    ) : null}
                  </View>

                  {item.plantingId ? (
                    <Text style={styles.doneMark}>植えた</Text>
                  ) : (
                    <Text
                      style={[
                        styles.timing,
                        timing === 'past' && styles.timingPast,
                        (timing === 'now' || timing === 'soon') && styles.timingNow,
                      ]}
                    >
                      {planTimingLabel(item.monthsUntil)}
                    </Text>
                  )}
                </PressableScale>

                {/* 変換は「時期が来たもの」にだけ出す。来年の予定にまで出すと、
                    押し間違いで先の栽培ができてしまう */}
                {!item.plantingId && item.monthsUntil <= 1 ? (
                  <PressableScale
                    style={styles.convertButton}
                    onPress={() => setConverting(item)}
                    accessibilityLabel={`${item.cropName}を栽培にする`}
                  >
                    <Sprout size={15} color={Colors.accentInk} />
                    <Text style={styles.convertText}>栽培にする</Text>
                  </PressableScale>
                ) : null}
              </View>
            );
          }}
        />
      )}

      <ConfirmSheet
        visible={converting != null}
        onClose={() => setConverting(null)}
        onConfirm={() => void handleConvert()}
        title="栽培にしますか"
        message={
          converting
            ? `${converting.cropName}を、今日の植え付けとして登録します。` +
              `${converting.placeName ? `場所は「${converting.placeName}」です。` : ''}` +
              '計画は「植えた」に残ります。'
            : ''
        }
        confirmLabel="登録する"
        destructive={false}
      />

      <Toast message={toast ?? ''} visible={toast != null} onDismiss={() => setToast(null)} />
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
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  tabChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  tabText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  tabTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: {
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cardBody: { flex: 1, gap: 4 },
  cropName: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  variety: { fontWeight: Typography.weight.regular, color: Colors.inkDim },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  note: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 17 },
  timing: { fontSize: Typography.size.xs, color: Colors.inkDim, textAlign: 'right', maxWidth: 96 },
  timingNow: { color: Colors.accentInk, fontWeight: Typography.weight.semibold },
  timingPast: { color: Colors.danger },
  doneMark: { fontSize: Typography.size.xs, color: Colors.accentInk },
  convertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
  convertText: { fontSize: Typography.size.sm, color: Colors.accentInk },
});

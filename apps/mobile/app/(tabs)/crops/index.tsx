/**
 * S17: 作物ガイド一覧 — R09 / WBS 3.3・4.19
 *
 * マスター作物を**分類ごと**に読み仮名順で。今月の「まきどき」「植えどき」「採りどき」を
 * 印で添える — ガイドを開く動機のほとんどは「いま何が始められるか」なので、
 * 一覧の時点で今月の目星が付くようにする。
 *
 * 4.19 で 50 品目になったので、検索欄と絞り込み（時期・初心者向け・プランター）を足した。
 * 「今月の菜園仕事」カードの行から来たときは `?now=sow|plant|harvest` で
 * **押した行と同じ種別**を最初から効かせる（レビュー 19: 以前は 3 行とも `?now=1` で
 * 同じ 26〜38 品目に飛び、絞り込みとして働いていなかった）。
 * 検索は名前・読み仮名・別名（店頭の呼び方）に当てる。カタカナで打っても
 * ひらがなで打っても当たるよう、読みは両方に寄せて比べる。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Search, X } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdBanner } from '../../../src/components/AdBanner';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  CROP_CATEGORY_LABEL,
  CROP_CATEGORY_ORDER,
  type CropCategory,
} from '../../../src/db/crop-master';
import { getCropGuideList, type CropGuideListItem } from '../../../src/services/crop-guide.service';
import { CROP_NAME_ALIASES, toHiragana } from '../../../src/services/crop-match.service';

export type Filter = 'all' | 'sow' | 'plant' | 'harvest' | 'beginner' | 'container';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'sow', label: 'まきどき' },
  { key: 'plant', label: '植えどき' },
  { key: 'harvest', label: '採りどき' },
  { key: 'beginner', label: '初心者向け' },
  { key: 'container', label: 'プランター' },
];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'すべて',
  sow: 'まきどき',
  plant: '植えどき',
  harvest: '採りどき',
  beginner: '初心者向け',
  container: 'プランター',
};

/** 今月の時期で絞るチップ（残りは編集者判断なので「今月」の文言を使わない） */
const SEASONAL: readonly Filter[] = ['sow', 'plant', 'harvest'];

/** `?now=` の値 → 初期チップ。'1'（4.19 第 1 段）の後方互換は捨てた */
export function filterFromParam(now: string | undefined): Filter {
  return now === 'sow' || now === 'plant' || now === 'harvest' ? now : 'all';
}

/** 名前・読み・別名のどれかに当たるか。純関数にして絞り込みをテストで固定する */
export function matchesQuery(crop: CropGuideListItem, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const qHira = toHiragana(q);
  if (crop.name.includes(q)) return true;
  if (crop.nameReading && crop.nameReading.includes(qHira)) return true;
  // 別名 → 正式名。別名の側に部分一致すれば、その正式名の作物を出す
  return Object.entries(CROP_NAME_ALIASES).some(
    ([alias, target]) =>
      target === crop.name && (alias.includes(q) || toHiragana(alias).includes(qHira)),
  );
}

export function matchesFilter(crop: CropGuideListItem, filter: Filter): boolean {
  switch (filter) {
    case 'sow':
      return crop.sowNow;
    case 'plant':
      return crop.plantNow;
    case 'harvest':
      return crop.harvestNow;
    case 'beginner':
      return crop.beginner;
    case 'container':
      return crop.containerOk;
    default:
      return true;
  }
}

/**
 * ヘッダーの件数。絞り込んでいるあいだは母数も出す（レビュー 11: 常に「50品目」だと
 * 1 月の「まきどき」8 件でも 50 と読めて、0 件の原因が分からない）
 */
export function describeCount(total: number, visible: number): string {
  return total === visible ? `${total}品目` : `${total}品目中 ${visible}件`;
}

/**
 * 0 件の理由。検索語だけ・チップだけ・両方で文言を変える（レビュー 11）。
 * 以前は 1 つの文言で「別の呼び方で探して」と検索語に原因を断定していたが、
 * 1 月の「まきどき」該当は 50 品目中 8 件しかなく、冬はチップだけで 0 件になる。
 */
export function describeEmpty(query: string, filter: Filter): string {
  const q = query.trim();
  const seasonal = SEASONAL.includes(filter);
  if (q && filter !== 'all') {
    return seasonal
      ? `「${q}」は今月の${FILTER_LABEL[filter]}にありませんでした。`
      : `「${q}」は「${FILTER_LABEL[filter]}」の中にありませんでした。`;
  }
  if (q) return `「${q}」に当たる作物がありませんでした。別の呼び方で探してみてください。`;
  if (seasonal) return `今月${FILTER_LABEL[filter]}の作物はありません。`;
  if (filter !== 'all') return `「${FILTER_LABEL[filter]}」に当てはまる作物はありません。`;
  return 'ガイドを読み込めませんでした。アプリを開き直してみてください。';
}

/**
 * 行の読み上げラベル。Pressable は既定で 1 つの要素になり、ラベルを付けた時点で
 * 子の Text（科・多年草・印）が読まれなくなる（レビュー 34a・MonthlyWorkCard と同じ理由）
 */
export function describeCropRowLabel(crop: CropGuideListItem): string {
  const parts = [
    crop.family ?? '',
    crop.perennial ? '多年草' : '',
    crop.sowNow ? 'まきどき' : '',
    crop.plantNow ? '植えどき' : '',
    crop.harvestNow ? '採りどき' : '',
  ].filter(Boolean);
  return parts.length > 0 ? `${crop.name}のガイド。${parts.join('、')}` : `${crop.name}のガイド`;
}

/**
 * 1 行。50 品目（将来 100）が検索の 1 文字ごとに作り直されるのを避けるため memo で切る
 * （レビュー 31a）。onPress は画面側で useCallback して同一参照を渡す
 */
const CropRow = memo(function CropRow({
  crop,
  onPress,
}: {
  crop: CropGuideListItem;
  onPress: (cropId: string) => void;
}) {
  const handlePress = useCallback(() => onPress(crop.cropId), [onPress, crop.cropId]);
  return (
    <PressableScale
      style={styles.row}
      onPress={handlePress}
      accessibilityLabel={describeCropRowLabel(crop)}
    >
      <View style={styles.rowText}>
        <Text style={styles.name}>{crop.name}</Text>
        <Text style={styles.meta}>
          {[crop.family ?? '', crop.perennial ? '多年草' : ''].filter(Boolean).join('・')}
        </Text>
      </View>
      {crop.sowNow ? <Text style={[styles.badge, styles.badgeStart]}>まきどき</Text> : null}
      {crop.plantNow ? <Text style={[styles.badge, styles.badgeStart]}>植えどき</Text> : null}
      {crop.harvestNow ? <Text style={[styles.badge, styles.badgeHarvest]}>採りどき</Text> : null}
    </PressableScale>
  );
});

export default function CropGuideListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ now?: string }>();
  const [crops, setCrops] = useState<CropGuideListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(filterFromParam(params.now));

  useFocusEffect(
    useCallback(() => {
      // 地域を変えて戻ってきたら印を引き直す
      void getCropGuideList()
        .then(setCrops)
        .catch(() => setCrops([]));
    }, []),
  );

  const openCrop = useCallback((cropId: string) => router.push(`/crops/${cropId}`), [router]);

  const clearFilters = useCallback(() => {
    setQuery('');
    setFilter('all');
  }, []);

  const isFiltered = filter !== 'all' || query.trim().length > 0;

  const { sections, visibleCount } = useMemo(() => {
    if (!crops) return { sections: [], visibleCount: 0 };
    const visible = crops.filter(
      (crop) => matchesQuery(crop, query) && matchesFilter(crop, filter),
    );
    const byCategory = new Map<CropCategory | 'other', CropGuideListItem[]>();
    for (const crop of visible) {
      const key = crop.category ?? 'other';
      const list = byCategory.get(key) ?? [];
      list.push(crop);
      byCategory.set(key, list);
    }
    const ordered: { key: string; label: string; crops: CropGuideListItem[] }[] = [];
    for (const category of CROP_CATEGORY_ORDER) {
      const list = byCategory.get(category);
      if (list && list.length > 0) {
        ordered.push({ key: category, label: CROP_CATEGORY_LABEL[category], crops: list });
      }
    }
    const other = byCategory.get('other');
    if (other && other.length > 0) ordered.push({ key: 'other', label: 'その他', crops: other });
    return { sections: ordered, visibleCount: visible.length };
  }, [crops, query, filter]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>作物ガイド</Text>
        {crops ? (
          // 絞り込むたびに件数が変わる。読み上げ利用者にも変化を伝える（レビュー 34c）
          <Text style={styles.count} accessibilityLiveRegion="polite">
            {describeCount(crops.length, visibleCount)}
          </Text>
        ) : null}
      </View>

      <View style={styles.searchBox}>
        <Search size={16} color={Colors.inkDim} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="作物名で探す（トウガラシ・空芯菜…）"
          placeholderTextColor={Colors.inkDim}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="作物を検索"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="検索を消す">
            <X size={16} color={Colors.inkDim} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}で絞り込む`}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {crops == null ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {sections.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{describeEmpty(query, filter)}</Text>
              {isFiltered ? (
                // 中央寄せの中に置くので PressableScale は使わない（flex が潰れる実績）
                <Pressable
                  style={styles.clearButton}
                  onPress={clearFilters}
                  accessibilityRole="button"
                  accessibilityLabel="絞り込みを解除"
                >
                  <Text style={styles.clearText}>絞り込みを解除</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {section.label}
              </Text>
              {section.crops.map((crop) => (
                <CropRow key={crop.cropId} crop={crop} onPress={openCrop} />
              ))}
            </View>
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
    paddingBottom: 8,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  count: { flex: 1, textAlign: 'right', fontSize: Typography.size.xs, color: Colors.inkDim },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: Typography.size.sm,
    color: Colors.ink,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    rowGap: 8,
    columnGap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  chipText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
    color: Colors.inkDim,
    paddingHorizontal: 2,
  },
  emptyBox: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  empty: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    textAlign: 'center',
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  clearText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
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

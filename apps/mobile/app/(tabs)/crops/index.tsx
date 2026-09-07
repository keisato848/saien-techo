/**
 * S17: 作物ガイド一覧 — R09 / WBS 3.3・4.19
 *
 * マスター作物を**分類ごと**に読み仮名順で。今月の「始めどき」「採りどき」を印で添える —
 * ガイドを開く動機のほとんどは「いま何が始められるか」なので、
 * 一覧の時点で今月の目星が付くようにする。
 *
 * 4.19 で 50 品目になったので、検索欄と絞り込み（今月・初心者向け・プランター）を足した。
 * 「今月の菜園仕事」カードの行から来たときは `?now=1` で「今月」を最初から効かせる。
 * 検索は名前・読み仮名・別名（店頭の呼び方）に当てる。カタカナで打っても
 * ひらがなで打っても当たるよう、読みは両方に寄せて比べる。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
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
import { CROP_NAME_ALIASES } from '../../../src/services/crop-match.service';

type Filter = 'all' | 'now' | 'beginner' | 'container';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'now', label: '今月' },
  { key: 'beginner', label: '初心者向け' },
  { key: 'container', label: 'プランター' },
];

/** カタカナ → ひらがな（読み仮名との比較用） */
function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
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
    case 'now':
      return crop.startNow || crop.harvestNow;
    case 'beginner':
      return crop.beginner;
    case 'container':
      return crop.containerOk;
    default:
      return true;
  }
}

export default function CropGuideListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ now?: string }>();
  const [crops, setCrops] = useState<CropGuideListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(params.now === '1' ? 'now' : 'all');

  useFocusEffect(
    useCallback(() => {
      // 地域を変えて戻ってきたら印を引き直す
      void getCropGuideList()
        .then(setCrops)
        .catch(() => setCrops([]));
    }, []),
  );

  const sections = useMemo(() => {
    if (!crops) return [];
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
    return ordered;
  }, [crops, query, filter]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>作物ガイド</Text>
        {crops ? <Text style={styles.count}>{crops.length}品目</Text> : null}
      </View>

      <View style={styles.searchBox}>
        <Search size={16} color={Colors.inkDim} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="作物名で探す（ししとう・空心菜…）"
          placeholderTextColor={Colors.inkDim}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="作物を検索"
        />
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
            <Text style={styles.empty}>見つかりませんでした。別の呼び方で探してみてください。</Text>
          ) : null}
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.label}</Text>
              {section.crops.map((crop) => (
                <PressableScale
                  key={crop.cropId}
                  style={styles.row}
                  onPress={() => router.push(`/crops/${crop.cropId}`)}
                  accessibilityLabel={`${crop.name}のガイド`}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{crop.name}</Text>
                    <Text style={styles.meta}>
                      {[crop.family ?? '', crop.perennial ? '多年草' : '']
                        .filter(Boolean)
                        .join('・')}
                    </Text>
                  </View>
                  {crop.startNow ? (
                    <Text style={[styles.badge, styles.badgeStart]}>始めどき</Text>
                  ) : null}
                  {crop.harvestNow ? (
                    <Text style={[styles.badge, styles.badgeHarvest]}>採りどき</Text>
                  ) : null}
                </PressableScale>
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
  count: { fontSize: Typography.size.xs, color: Colors.inkDim },
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
    gap: 8,
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
  empty: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    textAlign: 'center',
    paddingVertical: 24,
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

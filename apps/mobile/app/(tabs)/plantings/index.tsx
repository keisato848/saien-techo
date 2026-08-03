/**
 * S02: 栽培一覧・検索（R01 / R03）
 *
 * 「育成中 / 終了した栽培」の切り替え、FTS 検索、タグ・場所での絞り込み、並べ替え。
 *
 * 検索と絞り込みを別の帯に分けたのは、菜園では「トマトを探す」（検索）と
 * 「南の畝を見る」（絞り込み）が別の動機で起きるため。検索欄にすべて詰めると
 * 場所を見たいだけのときにキーボードが出る。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowUpDown, Plus, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '../../../src/components/BottomSheet';
import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import { getPlaceList } from '../../../src/services/place.service';
import {
  getPlantingList,
  getPlantingTagNames,
  PLANTING_SORTS,
  PLANTING_SORT_LABEL,
  type PlantingSort,
} from '../../../src/services/planting.service';
import type { PlaceItem, PlantingListItem } from '../../../src/services/types';
import { ENDED_REASON_LABEL, PLANTED_AS_LABEL } from '../../../src/validation/planting.schema';

type Filter = 'growing' | 'ended';

export default function PlantingListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [plantings, setPlantings] = useState<PlantingListItem[]>([]);
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<Filter>('growing');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [sort, setSort] = useState<PlantingSort>('planted_desc');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setPlantings(
      await getPlantingList({
        onlyEnded: filter === 'ended',
        query,
        tags: selectedTags,
        placeId,
        sort,
      }),
    );
    setLoading(false);
  }, [filter, query, selectedTags, placeId, sort]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setPlaces(await getPlaceList());
        setAllTags(await getPlantingTagNames());
      })();
    }, []),
  );

  const filterCount = selectedTags.length + (placeId ? 1 : 0);
  const isFiltered = filterCount > 0 || query.trim().length > 0;

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setPlaceId(null);
    setQuery('');
  }, []);

  const placeLabel =
    placeId === 'none' ? '場所なし' : (places.find((place) => place.id === placeId)?.name ?? null);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>栽培</Text>
        <PressableScale
          style={styles.addButton}
          onPress={() => router.push('/plantings/new')}
          accessibilityLabel="栽培を追加"
        >
          <Plus size={18} color={Colors.onAccent} />
        </PressableScale>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={Colors.inkDim} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="作物名・品種・タグで探す"
            placeholderTextColor={Colors.inkDim}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="検索を消す">
              <X size={16} color={Colors.inkDim} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={[styles.iconButton, filterCount > 0 && styles.iconButtonActive]}
          onPress={() => setFilterSheetOpen(true)}
          accessibilityLabel="絞り込み"
        >
          <SlidersHorizontal size={18} color={filterCount > 0 ? Colors.accentInk : Colors.inkDim} />
          {filterCount > 0 ? <Text style={styles.badge}>{filterCount}</Text> : null}
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={() => setSortSheetOpen(true)}
          accessibilityLabel="並べ替え"
        >
          <ArrowUpDown size={18} color={Colors.inkDim} />
        </Pressable>
      </View>

      <View style={styles.filters}>
        {(
          [
            ['growing', '育成中'],
            ['ended', '終了した栽培'],
          ] as [Filter, string][]
        ).map(([key, label]) => {
          const active = filter === key;
          return (
            <PressableScale
              key={key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => {
                setLoading(true);
                setFilter(key);
              }}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
            </PressableScale>
          );
        })}
      </View>

      {filterCount > 0 ? (
        <View style={styles.activeFilters}>
          {placeLabel ? (
            <Pressable style={styles.activeChip} onPress={() => setPlaceId(null)}>
              <Text style={styles.activeChipText}>{placeLabel}</Text>
              <X size={12} color={Colors.accentInk} />
            </Pressable>
          ) : null}
          {selectedTags.map((tag) => (
            <Pressable
              key={tag}
              style={styles.activeChip}
              onPress={() => setSelectedTags(selectedTags.filter((t) => t !== tag))}
            >
              <Text style={styles.activeChipText}>{tag}</Text>
              <X size={12} color={Colors.accentInk} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : plantings.length === 0 ? (
        <EmptyState
          icon={isFiltered ? '🔍' : '🌱'}
          title={
            isFiltered
              ? '見つかりませんでした'
              : filter === 'growing'
                ? 'まだ栽培がありません'
                : '終了した栽培はありません'
          }
          message={
            isFiltered
              ? '検索語や絞り込みを変えてみてください。'
              : filter === 'growing'
                ? '植えたものを登録すると、経過日数と作業の記録がここに並びます。'
                : undefined
          }
          actionLabel={
            isFiltered ? '条件をクリア' : filter === 'growing' ? '栽培を追加' : undefined
          }
          onAction={
            isFiltered
              ? clearFilters
              : filter === 'growing'
                ? () => router.push('/plantings/new')
                : undefined
          }
        />
      ) : (
        <FlatList
          data={plantings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PressableScale
              style={styles.card}
              onPress={() => router.push(`/plantings/${item.id}`)}
            >
              {item.coverPhotoUri ? (
                <Image source={{ uri: item.coverPhotoUri }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbEmoji}>🌱</Text>
                </View>
              )}

              <View style={styles.cardBody}>
                <Text style={styles.cropName} numberOfLines={1}>
                  {item.cropName}
                  {item.variety ? <Text style={styles.variety}>　{item.variety}</Text> : null}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    item.placeName,
                    PLANTED_AS_LABEL[item.plantedAs],
                    item.endedReason ? ENDED_REASON_LABEL[item.endedReason] : null,
                  ]
                    .filter(Boolean)
                    .join(' ・ ')}
                </Text>
              </View>

              {/* 経過日数は栽培の主指標なので右端に固定して縦に揃える（docs/画面設計.md S02） */}
              <View style={styles.elapsed}>
                <Text style={styles.elapsedNumber}>{item.elapsedDays}</Text>
                <Text style={styles.elapsedUnit}>日目</Text>
              </View>
            </PressableScale>
          )}
        />
      )}

      <BottomSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="絞り込み"
      >
        <ScrollView style={styles.sheetScroll}>
          <Text style={styles.sheetLabel}>場所</Text>
          <View style={styles.sheetChips}>
            <SheetChip label="すべて" active={placeId == null} onPress={() => setPlaceId(null)} />
            {places.map((place) => (
              <SheetChip
                key={place.id}
                label={place.name}
                active={placeId === place.id}
                onPress={() => setPlaceId(placeId === place.id ? null : place.id)}
              />
            ))}
            <SheetChip
              label="場所なし"
              active={placeId === 'none'}
              onPress={() => setPlaceId(placeId === 'none' ? null : 'none')}
            />
          </View>

          <Text style={[styles.sheetLabel, styles.sheetLabelSpaced]}>タグ</Text>
          {allTags.length === 0 ? (
            <Text style={styles.sheetHint}>まだタグが付いた栽培がありません。</Text>
          ) : (
            <View style={styles.sheetChips}>
              {allTags.map((tag) => (
                <SheetChip
                  key={tag}
                  label={tag}
                  active={selectedTags.includes(tag)}
                  onPress={() =>
                    setSelectedTags(
                      selectedTags.includes(tag)
                        ? selectedTags.filter((t) => t !== tag)
                        : [...selectedTags, tag],
                    )
                  }
                />
              ))}
            </View>
          )}
          {selectedTags.length > 1 ? (
            <Text style={styles.sheetHint}>
              タグを複数選ぶと、すべてに当てはまる栽培だけ出ます。
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.sheetActions}>
          <PressableScale
            containerStyle={styles.flexItem}
            style={styles.sheetClear}
            onPress={clearFilters}
          >
            <Text style={styles.sheetClearText}>条件をクリア</Text>
          </PressableScale>
          <PressableScale
            containerStyle={styles.flexItem}
            style={styles.sheetDone}
            onPress={() => setFilterSheetOpen(false)}
          >
            <Text style={styles.sheetDoneText}>閉じる</Text>
          </PressableScale>
        </View>
      </BottomSheet>

      <BottomSheet visible={sortSheetOpen} onClose={() => setSortSheetOpen(false)} title="並べ替え">
        {PLANTING_SORTS.map((option) => (
          <PressableScale
            key={option}
            style={styles.sortOption}
            onPress={() => {
              setSort(option);
              setSortSheetOpen(false);
            }}
          >
            <Text style={[styles.sortText, sort === option && styles.sortTextActive]}>
              {PLANTING_SORT_LABEL[option]}
            </Text>
          </PressableScale>
        ))}
      </BottomSheet>
    </View>
  );
}

function SheetChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressableScale>
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
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: Typography.size.base, color: Colors.ink, padding: 0 },
  iconButton: {
    width: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  badge: {
    fontSize: 10,
    color: Colors.accentInk,
    fontWeight: Typography.weight.semibold,
    marginTop: 1,
  },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  filterChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  filterText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  filterTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  activeFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accentLine,
  },
  activeChipText: { fontSize: Typography.size.xs, color: Colors.accentInk },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  thumbPlaceholder: {
    backgroundColor: Colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: { fontSize: 22 },
  cardBody: { flex: 1, gap: 4 },
  cropName: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  variety: { fontWeight: Typography.weight.regular, color: Colors.inkDim },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  elapsed: { alignItems: 'flex-end', minWidth: 44 },
  elapsedNumber: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    color: Colors.accent,
    fontVariant: ['tabular-nums'],
  },
  elapsedUnit: { fontSize: Typography.size.xs, color: Colors.inkDim },
  sheetScroll: { maxHeight: 280 },
  sheetLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  sheetLabelSpaced: { marginTop: 18 },
  sheetHint: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: 8 },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  // PressableScale は style を内側の Pressable に付けるので、行内で伸ばすには
  // containerStyle 側に flex を渡す必要がある
  flexItem: { flex: 1 },
  sheetClear: {
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
  },
  sheetClearText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  sheetDone: {
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  sheetDoneText: {
    fontSize: Typography.size.sm,
    color: Colors.onAccent,
    fontWeight: Typography.weight.semibold,
  },
  sortOption: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
  sortText: { fontSize: Typography.size.base, color: Colors.ink },
  sortTextActive: { color: Colors.accent, fontWeight: Typography.weight.semibold },
});

/**
 * S02: 栽培一覧（R01 / R03 の一部）
 *
 * WBS 1.5 では「育成中 / 終了した栽培」の切り替えと一覧表示まで。
 * 検索・並べ替え・タグ絞り込みは WBS 1.7 で足す。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import { getPlantingList } from '../../../src/services/planting.service';
import type { PlantingListItem } from '../../../src/services/types';
import { ENDED_REASON_LABEL, PLANTED_AS_LABEL } from '../../../src/validation/planting.schema';

type Filter = 'growing' | 'ended';

export default function PlantingListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [plantings, setPlantings] = useState<PlantingListItem[]>([]);
  const [filter, setFilter] = useState<Filter>('growing');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setPlantings(await getPlantingList(filter === 'ended' ? { onlyEnded: true } : {}));
    setLoading(false);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

      {loading ? (
        <Loading />
      ) : plantings.length === 0 ? (
        <EmptyState
          icon="🌱"
          title={filter === 'growing' ? 'まだ栽培がありません' : '終了した栽培はありません'}
          message={
            filter === 'growing'
              ? '植えたものを登録すると、経過日数と作業の記録がここに並びます。'
              : undefined
          }
          actionLabel={filter === 'growing' ? '栽培を追加' : undefined}
          onAction={filter === 'growing' ? () => router.push('/plantings/new') : undefined}
        />
      ) : (
        <FlatList
          data={plantings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
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
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
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
});

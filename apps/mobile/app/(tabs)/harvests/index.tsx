/**
 * S04: 収穫アルバム — R07 / WBS 2.2
 *
 * 収穫写真を月別のグリッドで並べる。作物で絞れる。
 *
 * **写真 1 枚が 1 マス**（収穫 1 件ではない）。1 回の収穫で複数枚撮ったとき、
 * 1 枚しか見えないとアルバムとして意味を成さない。
 * 写真の無い収穫もマスとして出す — 写真だけを並べると、数量だけ記録した収穫が
 * 一覧から消えてしまう。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ShoppingBasket } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { HarvestReadCard } from '../../../src/components/HarvestReadCard';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  getHarvestAlbum,
  getHarvestCropNames,
  groupByMonth,
  HARVEST_UNIT_LABEL,
} from '../../../src/services/harvest.service';
import type { HarvestMonth } from '../../../src/services/types';

/** 3 列。2 列だと写真が大きすぎて 1 か月が縦に長くなり、4 列だと何か分からない */
const COLUMNS = 3;
const GRID_GAP = 6;
const SCREEN_PADDING = 16;

function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const now = new Date();
  // 今年なら年を省く。毎行に年が付くと月の違いが読み取りにくい
  return year === now.getFullYear() ? `${m}月` : `${year}年${m}月`;
}

export default function HarvestAlbumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { plantingId } = useLocalSearchParams<{ plantingId?: string }>();

  const [months, setMonths] = useState<HarvestMonth[]>([]);
  const [cropNames, setCropNames] = useState<string[]>([]);
  const [cropName, setCropName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cellSize = Math.floor((width - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);

  const load = useCallback(async () => {
    const cells = await getHarvestAlbum({
      cropName: cropName ?? undefined,
      plantingId: plantingId ?? undefined,
    });
    setMonths(groupByMonth(cells));
    setLoading(false);
  }, [cropName, plantingId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      void (async () => setCropNames(await getHarvestCropNames()))();
    }, []),
  );

  const total = months.reduce((sum, month) => sum + month.cells.length, 0);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>収穫</Text>
        {total > 0 ? <Text style={styles.count}>{total}</Text> : null}
      </View>

      {cropNames.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // 横スクロールでも列方向に伸びようとするので止める。
          // 付けないとフィルタ帯の下に大きな余白ができる
          style={styles.filtersScroll}
          contentContainerStyle={styles.filters}
        >
          <PressableScale
            style={[styles.chip, cropName == null && styles.chipActive]}
            onPress={() => {
              setLoading(true);
              setCropName(null);
            }}
          >
            <Text style={[styles.chipText, cropName == null && styles.chipTextActive]}>すべて</Text>
          </PressableScale>
          {cropNames.map((name) => {
            const active = cropName === name;
            return (
              <PressableScale
                key={name}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  setLoading(true);
                  setCropName(active ? null : name);
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      ) : null}

      {/* 読み取り待ちがあるときだけ出る（0 件なら描画も余白も無い）。#143 */}
      <HarvestReadCard style={styles.readCard} />

      {loading ? (
        <Loading />
      ) : months.length === 0 ? (
        <EmptyState
          icon="🧺"
          title={cropName ? `${cropName}の収穫はまだありません` : 'まだ収穫がありません'}
          message={
            cropName ? undefined : '栽培を開いて「収穫した」から記録すると、ここに写真が並びます。'
          }
          actionLabel={cropName ? 'すべて表示' : undefined}
          onAction={cropName ? () => setCropName(null) : undefined}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {months.map((month) => (
            <View key={month.month} style={styles.month}>
              <Text style={styles.monthLabel}>{formatMonth(month.month)}</Text>
              <View style={styles.grid}>
                {month.cells.map((cell) => (
                  <PressableScale
                    key={cell.key}
                    style={{ width: cellSize }}
                    onPress={() =>
                      router.push(`/plantings/${cell.plantingId}/harvests/${cell.harvestId}`)
                    }
                    accessibilityLabel={`${cell.cropName}の収穫`}
                  >
                    {cell.photoUri ? (
                      <Image
                        source={{ uri: cell.photoUri }}
                        style={[styles.photo, { width: cellSize, height: cellSize }]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.photo,
                          styles.photoEmpty,
                          { width: cellSize, height: cellSize },
                        ]}
                      >
                        <ShoppingBasket size={22} color={Colors.harvest} />
                      </View>
                    )}
                    <Text style={styles.cellCrop} numberOfLines={1}>
                      {cell.cropName}
                    </Text>
                    <Text style={styles.cellMeta} numberOfLines={1}>
                      {new Date(cell.harvestedAt).getDate()}日
                      {cell.quantity != null && cell.unit
                        ? `　${cell.quantity}${HARVEST_UNIT_LABEL[cell.unit]}`
                        : ''}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  readCard: { marginHorizontal: 16, marginBottom: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: 12,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  count: {
    fontSize: Typography.size.sm,
    color: Colors.harvest,
    fontVariant: ['tabular-nums'],
  },
  filtersScroll: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: 8, paddingHorizontal: SCREEN_PADDING, paddingBottom: 12 },
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
  body: { paddingHorizontal: SCREEN_PADDING, paddingBottom: 32, gap: 22 },
  month: { gap: 10 },
  monthLabel: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    fontWeight: Typography.weight.medium,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  photo: { borderRadius: 10, backgroundColor: Colors.surfaceInput },
  photoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.harvestSoft,
  },
  cellCrop: {
    fontSize: Typography.size.xs,
    color: Colors.ink,
    marginTop: 5,
  },
  cellMeta: {
    fontSize: Typography.size.xxs,
    color: Colors.inkDim,
    fontVariant: ['tabular-nums'],
  },
});

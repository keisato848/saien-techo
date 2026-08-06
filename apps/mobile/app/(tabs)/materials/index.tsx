/**
 * S08: 資材在庫 — R12 / WBS 2.6
 *
 * 種・肥料・薬剤・土・道具の在庫。設定から入る。
 *
 * **一覧から直接 ± できる。** 「使った」の記録は編集画面を開かせると続かない。
 * 数量を持たない資材（道具など）には ± を出さない。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Minus, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  adjustMaterialQuantity,
  filterLowMaterials,
  getMaterials,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABEL,
} from '../../../src/services/material.service';
import type { MaterialCategory, MaterialItem } from '../../../src/services/types';

export default function MaterialListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [category, setCategory] = useState<MaterialCategory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setMaterials(await getMaterials(category ?? undefined));
    setLoading(false);
  }, [category]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const lowIds = new Set(filterLowMaterials(materials).map((item) => item.id));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>資材</Text>
        <PressableScale
          style={styles.addButton}
          onPress={() => router.push('/materials/new')}
          accessibilityLabel="資材を追加"
        >
          <Plus size={18} color={Colors.onAccent} />
        </PressableScale>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={styles.filters}
      >
        <PressableScale
          style={[styles.chip, category == null && styles.chipActive]}
          onPress={() => {
            setLoading(true);
            setCategory(null);
          }}
        >
          <Text style={[styles.chipText, category == null && styles.chipTextActive]}>すべて</Text>
        </PressableScale>
        {MATERIAL_CATEGORIES.map((option) => {
          const active = category === option;
          return (
            <PressableScale
              key={option}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setLoading(true);
                setCategory(active ? null : option);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {MATERIAL_CATEGORY_LABEL[option]}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {loading ? (
        <Loading />
      ) : materials.length === 0 ? (
        <EmptyState
          icon="🧰"
          title={category ? 'この分類の資材はありません' : 'まだ資材がありません'}
          message={
            category
              ? undefined
              : '肥料や薬剤を登録しておくと、残りが少なくなったときにお知らせします。'
          }
          actionLabel={category ? 'すべて表示' : '資材を追加'}
          onAction={category ? () => setCategory(null) : () => router.push('/materials/new')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {materials.map((item) => {
            const low = lowIds.has(item.id);
            return (
              <View key={item.id} style={[styles.card, low && styles.cardLow]}>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => router.push(`/materials/${item.id}/edit`)}
                >
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {MATERIAL_CATEGORY_LABEL[item.category]}
                    {low ? '　残りわずか' : ''}
                  </Text>
                </Pressable>

                {item.quantity != null ? (
                  <View style={styles.stepper}>
                    <Pressable
                      hitSlop={8}
                      onPress={() => void adjustMaterialQuantity(item.id, -1).then(load)}
                      accessibilityLabel={`${item.name}を減らす`}
                    >
                      <Minus size={18} color={Colors.inkDim} />
                    </Pressable>
                    <Text style={[styles.quantity, low && styles.quantityLow]}>
                      {item.quantity}
                      {item.unit ?? ''}
                    </Text>
                    <Pressable
                      hitSlop={8}
                      onPress={() => void adjustMaterialQuantity(item.id, 1).then(load)}
                      accessibilityLabel={`${item.name}を増やす`}
                    >
                      <Plus size={18} color={Colors.inkDim} />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.meta}>—</Text>
                )}
              </View>
            );
          })}
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
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
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
  filtersScroll: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderRadius: 14, borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  cardLow: { borderColor: Colors.harvestLine, backgroundColor: Colors.harvestSoft },
  cardMain: { flex: 1, gap: 3 },
  name: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quantity: {
    fontSize: Typography.size.base,
    color: Colors.ink,
    minWidth: 52,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  quantityLow: { color: Colors.harvest, fontWeight: Typography.weight.semibold },
});

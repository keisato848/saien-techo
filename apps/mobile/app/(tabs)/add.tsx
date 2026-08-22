/**
 * S03: 追加 — なにを記録するかを選ぶ画面（WBS 2.9b で作り直し）
 *
 * だいどこの add.tsx はレシピの作成方法シートだった。さいえん手帳の中央タブは
 * 「きょうの記録」への近道にする — 作業と収穫は毎日、栽培の追加はときどき。
 *
 * 作業・収穫は栽培を選んでからフォームへ。**栽培が 1 件ならワンタップで直行**する。
 * 選択肢が 1 つしかない画面を挟むと、毎日の記録が毎回 1 タップ重くなる。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Droplets, ShoppingBasket, Sprout } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '../../src/components/PressableScale';
import { Colors, Typography } from '../../src/constants/theme';
import { getPlantingList } from '../../src/services/planting.service';
import type { PlantingListItem } from '../../src/services/types';

/** 作業(care)か収穫(harvest)の記録先を選んでいる状態。menu はその手前 */
type Mode = 'menu' | 'care' | 'harvest';

export default function AddScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [plantings, setPlantings] = useState<PlantingListItem[]>([]);
  const [mode, setMode] = useState<Mode>('menu');

  useFocusEffect(
    useCallback(() => {
      // タブへ戻ってくるたびに選択からやり直す（前回の途中状態を残さない）
      setMode('menu');
      void getPlantingList({}).then(setPlantings);
    }, []),
  );

  const hasPlantings = plantings.length > 0;

  /** 作業・収穫の行を押したとき。栽培 1 件なら直行、複数なら選ばせる */
  const startRecord = (kind: 'care' | 'harvest') => {
    if (!hasPlantings) return;
    if (plantings.length === 1) {
      goToForm(kind, plantings[0].id);
      return;
    }
    setMode(kind);
  };

  const goToForm = (kind: 'care' | 'harvest', plantingId: string) => {
    router.push(
      kind === 'care'
        ? `/plantings/${plantingId}/care-logs/new`
        : `/plantings/${plantingId}/harvests/new`,
    );
  };

  if (mode !== 'menu') {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => setMode('menu')} hitSlop={12} accessibilityLabel="もどる">
            <ChevronLeft size={22} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>
            {mode === 'care' ? 'どの栽培の作業ですか' : 'どの栽培の収穫ですか'}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {plantings.map((planting) => (
            <PressableScale
              key={planting.id}
              style={styles.plantingRow}
              onPress={() => goToForm(mode, planting.id)}
            >
              <Text style={styles.plantingName}>{planting.cropName}</Text>
              <Text style={styles.plantingMeta}>{planting.elapsedDays}日目</Text>
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>追加</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <PressableScale
          style={[styles.card, !hasPlantings && styles.cardDisabled]}
          onPress={() => startRecord('care')}
          disabled={!hasPlantings}
          accessibilityLabel="作業を記録"
        >
          <View style={styles.cardIcon}>
            <Droplets size={22} color={Colors.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>作業を記録</Text>
            <Text style={styles.cardDescription}>水やり・追肥などを 1 タップで</Text>
          </View>
        </PressableScale>

        <PressableScale
          style={[styles.card, !hasPlantings && styles.cardDisabled]}
          onPress={() => startRecord('harvest')}
          disabled={!hasPlantings}
          accessibilityLabel="収穫を記録"
        >
          <View style={styles.cardIcon}>
            <ShoppingBasket size={22} color={Colors.harvest} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>収穫を記録</Text>
            <Text style={styles.cardDescription}>写真と数量をさっと残す</Text>
          </View>
        </PressableScale>

        {!hasPlantings ? (
          <Text style={styles.hint}>先に栽培を追加すると、作業と収穫を記録できます。</Text>
        ) : null}

        <PressableScale
          style={styles.card}
          onPress={() => router.push('/plantings/new')}
          accessibilityLabel="栽培を追加"
        >
          <View style={styles.cardIcon}>
            <Sprout size={22} color={Colors.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>栽培を追加</Text>
            <Text style={styles.cardDescription}>新しく育てはじめる</Text>
          </View>
        </PressableScale>
      </ScrollView>
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
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  cardDisabled: { opacity: 0.45, borderRadius: 14 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 3 },
  cardLabel: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  cardDescription: { fontSize: Typography.size.sm, color: Colors.inkDim },
  hint: {
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    lineHeight: 18,
    marginTop: -4,
  },
  plantingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  plantingName: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  plantingMeta: { fontSize: Typography.size.sm, color: Colors.accentInk },
});

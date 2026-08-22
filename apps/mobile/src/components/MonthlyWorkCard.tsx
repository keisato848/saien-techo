/**
 * 「今月の菜園仕事」カード — R08 / WBS 3.2
 *
 * ホームに置く。今月まける・植えられる・採れる作物を地域帯に合わせて出す。
 * 右上の地域ラベルから設定（/region）へ飛べる — 「うちは寒冷地なのに」に
 * その場で気づいて直せるように。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { CROP_MASTER_ATTRIBUTION } from '../db/crop-master';
import { getMonthlyGardenWork, type MonthlyGardenWork } from '../services/garden-work.service';
import { REGION_LABEL } from '../services/region.service';

const ROWS = [
  { key: 'sow', label: 'まきどき' },
  { key: 'plant', label: '植えどき' },
  { key: 'harvest', label: '採りどき' },
] as const;

export function MonthlyWorkCard() {
  const router = useRouter();
  const [work, setWork] = useState<MonthlyGardenWork | null>(null);

  useFocusEffect(
    useCallback(() => {
      // 地域を設定で変えて戻ってきたら引き直す
      void getMonthlyGardenWork()
        .then(setWork)
        .catch(() => setWork(null));
    }, []),
  );

  if (!work) return null;
  const hasAny = work.sow.length + work.plant.length + work.harvest.length > 0;
  if (!hasAny) return null;

  return (
    <View style={styles.card} testID="monthly-work-card">
      <View style={styles.header}>
        <Text style={styles.title}>{work.month}月の菜園仕事</Text>
        <Pressable
          onPress={() => router.push('/region')}
          hitSlop={8}
          accessibilityLabel="地域を変更"
        >
          <Text style={styles.region}>{REGION_LABEL[work.region]}</Text>
        </Pressable>
      </View>

      {ROWS.map(({ key, label }) =>
        work[key].length > 0 ? (
          <View key={key} style={styles.row}>
            <Text style={[styles.rowLabel, key === 'harvest' && styles.rowLabelHarvest]}>
              {label}
            </Text>
            <Text style={styles.rowCrops}>{work[key].map((crop) => crop.name).join('、')}</Text>
          </View>
        ) : null,
      )}

      {/* 育て方の中身はガイドへ（R09）。カードは「何があるか」までにとどめる */}
      <Pressable
        onPress={() => router.push('/crops')}
        hitSlop={6}
        accessibilityLabel="作物ガイドをみる"
      >
        <Text style={styles.guideLink}>作物ガイドをみる →</Text>
      </Pressable>

      {/* 出典（判断②）: 専門家のレビューの代わりに公的資料と突き合わせている。
          何に基づく目安かを小さく明記する。詳細一覧は作物ガイド(3.3)に置く */}
      <Text style={styles.attribution}>{CROP_MASTER_ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
  },
  region: {
    fontSize: Typography.size.xs,
    color: Colors.accentInk,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  rowLabel: {
    width: 58,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.accentInk,
  },
  rowLabelHarvest: {
    color: Colors.harvest,
  },
  rowCrops: {
    flex: 1,
    fontSize: Typography.size.sm,
    color: Colors.ink,
    lineHeight: 20,
  },
  guideLink: {
    fontSize: Typography.size.sm,
    color: Colors.accentInk,
    fontWeight: Typography.weight.medium,
  },
  attribution: {
    fontSize: 10,
    color: Colors.inkDim,
    marginTop: 2,
  },
});

/**
 * 質問チップ（R15 / WBS 4.14・#138）
 *
 * 初心者は症状を言語化できない — 黄色い葉を見ても、それが「下葉の黄変」なのか
 * 「うどんこ病」なのか「水切れ」なのか分からない。作物のよくある虫・病気と
 * 汎用の症状を並べ、**タップするだけで相談文ができる**ようにする。
 *
 * **AI 呼び出しはゼロ**。作物マスターの `commonPests` を読むだけなので、
 * オフラインでも即座に出る（ローカルファースト）。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';

interface QuestionChipsProps {
  chips: readonly string[];
  onSelect: (chip: string) => void;
}

export function QuestionChips({ chips, onSelect }: QuestionChipsProps) {
  // チップが 0 件になるのは作物マスターが空の端末くらいだが、その場合は
  // 見出しごと出さない（空の帯だけが残ると壊れて見える）
  if (chips.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text style={styles.label}>よくある相談から選ぶ</Text>
      <View style={styles.row}>
        {chips.map((chip) => (
          <Pressable
            key={chip}
            onPress={() => onSelect(chip)}
            accessibilityRole="button"
            accessibilityLabel={`${chip}を相談文に入れる`}
            style={styles.chip}
            hitSlop={4}
          >
            <Text style={styles.chipText}>{chip}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 16, gap: 8 },
  label: { fontSize: Typography.size.sm, color: Colors.inkDim },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  chipText: { fontSize: Typography.size.xs, color: Colors.accentInk },
});

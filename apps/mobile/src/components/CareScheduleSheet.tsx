/**
 * ケアスケジュールの提案シート — R26 / WBS 4.8
 *
 * 栽培を登録した直後に開く。作物ガイドから組み立てた水やり・追肥のお知らせを
 * 並べ、選んだものだけを作る。
 *
 * **既定はすべて OFF。** 「登録したら勝手に鳴り出した」を避けるため
 * （care-schedule.service の冒頭）。何も選ばずに閉じても登録は済んでいる、
 * ということが分かる文言にしてある。
 */
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { CARE_KIND_LABEL } from '../services/care-log.service';
import {
  describeCareSuggestion,
  type CareScheduleSuggestion,
} from '../services/care-schedule.service';
import { BottomSheet } from './BottomSheet';

interface CareScheduleSheetProps {
  visible: boolean;
  cropName: string;
  suggestions: CareScheduleSuggestion[];
  /** 選ばれた提案。空配列で押されることはない（ボタンが無効になる） */
  onApply: (selected: CareScheduleSuggestion[]) => void;
  /** 「あとで」または背景タップ。登録自体は済んでいる */
  onSkip: () => void;
}

export function CareScheduleSheet({
  visible,
  cropName,
  suggestions,
  onApply,
  onSkip,
}: CareScheduleSheetProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // 別の栽培で開き直したときに前回の選択が残らないようにする
  // （新規登録の画面は再マウントされないことがある — plantings/new.tsx の注記）
  useEffect(() => {
    if (visible) {
      setSelected([]);
      setSaving(false);
    }
  }, [visible, suggestions]);

  const toggle = (index: number) => {
    setSelected((current) =>
      current.includes(index) ? current.filter((i) => i !== index) : [...current, index],
    );
  };

  const apply = () => {
    if (saving || selected.length === 0) return;
    setSaving(true);
    onApply(suggestions.filter((_, index) => selected.includes(index)));
  };

  return (
    <BottomSheet visible={visible} onClose={onSkip} title="お知らせを作りますか">
      <Text style={styles.lead}>
        {cropName}
        を登録しました。育て方から、お知らせの目安を用意しています。必要なものだけ選べます。
      </Text>

      <View style={styles.list}>
        {suggestions.map((suggestion, index) => {
          const active = selected.includes(index);
          const label = CARE_KIND_LABEL[suggestion.kind];
          return (
            <Pressable
              key={`${suggestion.kind}-${suggestion.scheduleKind}-${suggestion.intervalDays}`}
              style={[styles.row, active && styles.rowActive]}
              onPress={() => toggle(index)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${label} ${describeCareSuggestion(suggestion)}`}
            >
              <View style={[styles.box, active && styles.boxActive]}>
                {active ? <Check size={13} color={Colors.onAccent} /> : null}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {label}／{describeCareSuggestion(suggestion)}
                </Text>
                <Text style={styles.rowReason}>{suggestion.reason}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 通知は「必ずこの時刻に鳴る」とは言えない（reminder.service の Doze の項）。
          期待値を上げないよう、ここでも目安として書く */}
      <Text style={styles.note}>時刻はおおよその目安です。あとから栽培の詳細で変えられます。</Text>

      <View style={styles.buttons}>
        <Pressable style={styles.skipButton} onPress={onSkip} accessibilityLabel="あとで">
          <Text style={styles.skipText}>あとで</Text>
        </Pressable>
        {/* disabled は付けない。RNTL では無効な Pressable への press が
            BottomSheet の外枠まで抜けてしまい、押しても何も起きないことを
            テストで確かめられなくなる。押せないことは apply() の番人と
            accessibilityState で表す */}
        <Pressable
          style={[styles.applyButton, selected.length === 0 && styles.disabled]}
          onPress={apply}
          accessibilityState={{ disabled: selected.length === 0 || saving }}
          accessibilityLabel="選んだお知らせを作る"
        >
          <Text style={styles.applyText}>お知らせを作る</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 20, marginBottom: 14 },
  list: { gap: 8, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  rowActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  rowText: { flex: 1, gap: 3 },
  rowTitle: {
    fontSize: Typography.size.base,
    color: Colors.ink,
    fontWeight: Typography.weight.medium,
  },
  rowReason: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18 },
  note: { fontSize: Typography.size.xs, color: Colors.inkDim, marginBottom: 16 },
  buttons: { flexDirection: 'row', gap: 12 },
  skipButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
  },
  skipText: { fontSize: Typography.size.base, color: Colors.inkDim },
  applyButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  applyText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  disabled: { opacity: 0.5 },
});

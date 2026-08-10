/**
 * 日付入力フィールド（WBS 1.5）
 *
 * 値は ISO 8601 文字列で持ち、表示は端末のロケールに任せる。
 * 「今日」ボタンを添えてあるのは、植え付け直後の登録が最頻ケースだから（R01）。
 * ピッカーは OS 標準のものを出す — 自作の日付入力は誤操作が多いため。
 *
 * quickPicks は「さかのぼって登録する」ための相対日付チップ。
 * アプリを入れる前から育てている株や、付け忘れた作業を後から入れるとき、
 * OS のピッカーで年月日を辿らせると手数が多く、既定の「今日」のまま
 * 保存されやすい。植え付け日がずれると経過日数がずれ、R10 の
 * 「次の作業」（追肥・収穫の目安日数との突き合わせ）まで狂う。
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';

const DAY_MS = 86_400_000;

export interface DateQuickPick {
  label: string;
  daysAgo: number;
}

/**
 * 「すでに育てている株」を後から登録するとき用（R01）。
 * 苗を買ってきた直後だけでなく、アプリを入れた時点で育っているものを
 * 入れられることを、チップの存在自体で示す。
 */
export const PLANTING_DATE_QUICK_PICKS: DateQuickPick[] = [
  { label: '1週間前', daysAgo: 7 },
  { label: '1か月前', daysAgo: 30 },
  { label: '3か月前', daysAgo: 90 },
];

/** 付け忘れた作業や、ギャラリーの古い写真を後から入れるとき用（R04） */
export const CARE_LOG_DATE_QUICK_PICKS: DateQuickPick[] = [
  { label: '昨日', daysAgo: 1 },
  { label: '3日前', daysAgo: 3 },
  { label: '1週間前', daysAgo: 7 },
];

/**
 * ちょうど n 日前の同時刻。
 *
 * 日付を切り下げず「今の時刻から n×24時間前」にしているのは、
 * planting.service の elapsedDaysFrom が floor((end - start) / 86400000) で
 * 数えるため。こうしておくと「1週間前」を押した直後の表示が必ず 7 日目になり、
 * チップの文言と画面の日数が食い違わない。
 */
export function isoDaysAgo(daysAgo: number, now: Date = new Date()): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  error?: string;
  /** さかのぼり用の相対日付チップ。省略すると出ない */
  quickPicks?: DateQuickPick[];
  /** 入力欄の下に出す補足（「今日で 30 日目」など） */
  hint?: string;
}

export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function DateField({
  label,
  value,
  onChange,
  required,
  error,
  quickPicks,
  hint,
}: DateFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const parsed = new Date(value);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>

      <View style={styles.row}>
        <Pressable
          style={[styles.input, error ? styles.inputError : null]}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}を選ぶ`}
        >
          <Calendar size={16} color={Colors.inkDim} />
          <Text style={styles.value}>{formatDateLabel(value)}</Text>
        </Pressable>
        <Pressable
          style={styles.todayButton}
          onPress={() => onChange(new Date().toISOString())}
          accessibilityRole="button"
        >
          <Text style={styles.todayText}>今日</Text>
        </Pressable>
      </View>

      {/* 横並びの帯は wrap させる。3 つでも端末幅によっては溢れるため */}
      {quickPicks && quickPicks.length > 0 ? (
        <View style={styles.quickPicksRow}>
          {quickPicks.map((pick) => (
            <Pressable
              key={pick.label}
              style={styles.quickPick}
              onPress={() => onChange(isoDaysAgo(pick.daysAgo))}
              accessibilityRole="button"
              accessibilityLabel={`${label}を${pick.label}にする`}
            >
              <Text style={styles.quickPickText}>{pick.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {pickerOpen ? (
        <DateTimePicker
          value={safeDate}
          mode="date"
          // 未来の植え付けは記録ではなく作付け計画（R17・v1.6）の領分
          maximumDate={new Date()}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            // Android は選択・キャンセルどちらでもここに来るので閉じ切る
            setPickerOpen(false);
            if (event.type === 'set' && selected) onChange(selected.toISOString());
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  required: { color: Colors.accent },
  row: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  input: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputError: { borderColor: Colors.danger },
  value: { fontSize: Typography.size.base, color: Colors.ink },
  todayButton: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  todayText: {
    fontSize: Typography.size.sm,
    color: Colors.accentInk,
    fontWeight: Typography.weight.medium,
  },
  quickPicksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  quickPick: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  quickPickText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  hint: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: 8 },
  error: { fontSize: Typography.size.xs, color: Colors.danger, marginTop: 6 },
});

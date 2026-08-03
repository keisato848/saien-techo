/**
 * 日付入力フィールド（WBS 1.5）
 *
 * 値は ISO 8601 文字列で持ち、表示は端末のロケールに任せる。
 * 「今日」ボタンを添えてあるのは、植え付け直後の登録が最頻ケースだから（R01）。
 * ピッカーは OS 標準のものを出す — 自作の日付入力は誤操作が多いため。
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  error?: string;
}

export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function DateField({ label, value, onChange, required, error }: DateFieldProps) {
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
  error: { fontSize: Typography.size.xs, color: Colors.danger, marginTop: 6 },
});

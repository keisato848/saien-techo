/**
 * リマインダーの設定フォーム（R11 / WBS 2.5）
 *
 * **「毎日」を既定にしている。** N 日おきは次の 1 回しか OS に予約できず、
 * アプリを長く開かないと止まる（reminder.service の冒頭参照）。
 * 迷ったときに選ばれる位置には、止まらない方を置く。
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { CARE_KIND_LABEL, CARE_KINDS } from '../services/care-log.service';
import type { CareLogKind, ReminderScheduleKind } from '../services/types';
import { WEEKDAY_SHORT } from '../utils/reminderSchedule';
import { PressableScale } from './PressableScale';

export interface ReminderFormValues {
  kind: CareLogKind;
  scheduleKind: ReminderScheduleKind;
  intervalDays: number | null;
  weekdays: number[];
  hour: number;
  minute: number;
}

interface ReminderFormProps {
  initialValues?: Partial<ReminderFormValues>;
  onSubmit: (values: ReminderFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  footer?: React.ReactNode;
}

const SCHEDULE_LABEL: Record<ReminderScheduleKind, string> = {
  daily: '毎日',
  weekly: '曜日で',
  interval_days: '日数で',
};

/** 時刻はよく使う値だけ出す。ピッカーを出すほどの精度は要らない */
const HOURS = [5, 6, 7, 8, 9, 10, 12, 15, 17, 18, 19, 20];

export function ReminderForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  footer,
}: ReminderFormProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<CareLogKind>(initialValues?.kind ?? 'water');
  const [scheduleKind, setScheduleKind] = useState<ReminderScheduleKind>(
    initialValues?.scheduleKind ?? 'daily',
  );
  const [intervalText, setIntervalText] = useState(
    initialValues?.intervalDays != null ? String(initialValues.intervalDays) : '3',
  );
  const [weekdays, setWeekdays] = useState<number[]>(initialValues?.weekdays ?? []);
  const [hour, setHour] = useState(initialValues?.hour ?? 7);
  const [minute, setMinute] = useState(initialValues?.minute ?? 0);
  const [saving, setSaving] = useState(false);

  const parsedInterval = Number.parseInt(intervalText.replace(/[^0-9]/g, ''), 10);
  const intervalDays =
    Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : null;
  const canSave =
    scheduleKind === 'daily' ||
    (scheduleKind === 'weekly' && weekdays.length > 0) ||
    (scheduleKind === 'interval_days' && intervalDays != null);

  const submit = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      await onSubmit({ kind, scheduleKind, intervalDays, weekdays, hour, minute });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.headerAction}>キャンセル</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable onPress={() => void submit()} hitSlop={12} disabled={saving || !canSave}>
          <Text
            style={[
              styles.headerAction,
              styles.headerSubmit,
              (saving || !canSave) && styles.disabled,
            ]}
          >
            {saving ? '保存中' : submitLabel}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Text style={styles.groupLabel}>作業</Text>
          <View style={styles.chips}>
            {CARE_KINDS.map((option) => {
              const active = kind === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setKind(option)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {CARE_KIND_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>くりかえし</Text>
          <View style={styles.chips}>
            {(['daily', 'weekly', 'interval_days'] as ReminderScheduleKind[]).map((option) => {
              const active = scheduleKind === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setScheduleKind(option)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {SCHEDULE_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {scheduleKind === 'weekly' ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>曜日</Text>
            <View style={styles.chips}>
              {WEEKDAY_SHORT.map((label, day) => {
                const active = weekdays.includes(day);
                return (
                  <PressableScale
                    key={label}
                    style={[styles.dayChip, active && styles.chipActive]}
                    onPress={() =>
                      setWeekdays(active ? weekdays.filter((d) => d !== day) : [...weekdays, day])
                    }
                    accessibilityLabel={`${label}曜日`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </PressableScale>
                );
              })}
            </View>
            {weekdays.length === 0 ? (
              <Text style={styles.warn}>曜日を 1 つ以上選んでください。</Text>
            ) : null}
          </View>
        ) : null}

        {scheduleKind === 'interval_days' ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>間隔</Text>
            <View style={styles.intervalRow}>
              <TextInput
                style={styles.intervalInput}
                value={intervalText}
                onChangeText={setIntervalText}
                keyboardType="number-pad"
                accessibilityLabel="間隔の日数"
              />
              <Text style={styles.intervalUnit}>日おき</Text>
            </View>
            <Text style={styles.hint}>
              日数指定は、アプリをしばらく開かないと止まります。毎日か曜日で足りるなら
              そちらが確実です。
            </Text>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.groupLabel}>時刻</Text>
          <View style={styles.chips}>
            {HOURS.map((option) => {
              const active = hour === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setHour(option)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}時</Text>
                </PressableScale>
              );
            })}
          </View>
          <View style={[styles.chips, styles.minuteRow]}>
            {[0, 30].map((option) => {
              const active = minute === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setMinute(option)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {String(option).padStart(2, '0')}分
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={styles.hint}>
            端末の省電力の状態によっては、数十分ずれて届くことがあります。
          </Text>
        </View>

        {footer}
      </ScrollView>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerAction: { fontSize: Typography.size.sm, color: Colors.inkDim },
  headerSubmit: { color: Colors.accent, fontWeight: Typography.weight.semibold },
  disabled: { opacity: 0.4 },
  body: { padding: 16, paddingBottom: 48 },
  group: { marginBottom: 20 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  minuteRow: { marginTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  dayChip: {
    width: 42,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderRadius: 14, borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  intervalInput: {
    width: 72,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Typography.size.md,
    color: Colors.ink,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  intervalUnit: { fontSize: Typography.size.base, color: Colors.ink },
  hint: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: 8, lineHeight: 18 },
  warn: { fontSize: Typography.size.xs, color: Colors.danger, marginTop: 8 },
});

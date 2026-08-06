/**
 * 作業ログの記録・編集フォーム（R04 / WBS 1.8）
 *
 * クイック記録（栽培詳細の 5 ボタン）で足りない場合の入り口。
 * 種別・日時・メモ・写真（最大 6 枚）を編集する。
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { CARE_KIND_LABEL, CARE_KINDS } from '../services/care-log.service';
import type { CareLogKind } from '../services/types';
import { DateField } from './DateField';
import { FormField } from './FormField';
import { PhotoGridField } from './PhotoGridField';
import { PressableScale } from './PressableScale';

export interface CareLogFormValues {
  kind: CareLogKind;
  loggedAt: string;
  note: string;
  photoUris: string[];
}

interface CareLogFormProps {
  initialValues?: Partial<CareLogFormValues>;
  onSubmit: (values: CareLogFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  footer?: React.ReactNode;
}

export function CareLogForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  footer,
}: CareLogFormProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<CareLogKind>(initialValues?.kind ?? 'water');
  const [loggedAt, setLoggedAt] = useState(initialValues?.loggedAt ?? new Date().toISOString());
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [photoUris, setPhotoUris] = useState<string[]>(initialValues?.photoUris ?? []);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSubmit({ kind, loggedAt, note, photoUris });
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
        <Pressable onPress={() => void submit()} hitSlop={12} disabled={saving}>
          <Text style={[styles.headerAction, styles.headerSubmit, saving && styles.disabled]}>
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

        <DateField label="日付" required value={loggedAt} onChange={setLoggedAt} />

        <View style={styles.group}>
          <Text style={styles.groupLabel}>写真</Text>
          <PhotoGridField value={photoUris} onChange={setPhotoUris} />
        </View>

        <FormField
          label="メモ"
          value={note}
          onChangeText={setNote}
          placeholder="うどんこ病が出たので薬剤散布 など"
          multiline
          numberOfLines={4}
          style={styles.noteInput}
        />

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
  disabled: { opacity: 0.5 },
  body: { padding: 16, paddingBottom: 48 },
  group: { marginBottom: 16 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  // FormField が枠込みの高さとして扱う（4 行ぶん）
  noteInput: { minHeight: 112, textAlignVertical: 'top' },
});

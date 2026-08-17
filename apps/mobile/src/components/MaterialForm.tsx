/**
 * 資材の登録・編集フォーム（R12 / WBS 2.6）
 *
 * **数量は任意。** 道具のように数えないものがあるので、入れなくても登録できる。
 * 数量を入れたときだけ、単位と「残りわずかの目安」が出る — 数量が無いのに
 * 閾値だけあっても通知しようがない。
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL } from '../services/material.service';
import type { MaterialCategory } from '../services/types';
import { FormField } from './FormField';
import { KeyboardAvoider } from './KeyboardAvoider';
import { PressableScale } from './PressableScale';

export interface MaterialFormValues {
  name: string;
  category: MaterialCategory;
  quantity: number | null;
  unit: string;
  lowThreshold: number | null;
  note: string;
}

interface MaterialFormProps {
  initialValues?: Partial<MaterialFormValues>;
  onSubmit: (values: MaterialFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  footer?: React.ReactNode;
}

/** よく使う単位。自由入力もできる */
const UNIT_SUGGESTIONS = ['袋', 'kg', 'g', 'L', '本', '個'];

function toNumber(text: string): number | null {
  const parsed = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function MaterialForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  footer,
}: MaterialFormProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [category, setCategory] = useState<MaterialCategory>(
    initialValues?.category ?? 'fertilizer',
  );
  const [quantityText, setQuantityText] = useState(
    initialValues?.quantity != null ? String(initialValues.quantity) : '',
  );
  const [unit, setUnit] = useState(initialValues?.unit ?? '');
  const [thresholdText, setThresholdText] = useState(
    initialValues?.lowThreshold != null ? String(initialValues.lowThreshold) : '',
  );
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const quantity = toNumber(quantityText);
  const nameError = touched && name.trim().length === 0 ? '名前は必須です' : undefined;

  const submit = async () => {
    setTouched(true);
    if (saving || name.trim().length === 0) return;
    setSaving(true);
    try {
      await onSubmit({
        name,
        category,
        quantity,
        unit,
        lowThreshold: quantity != null ? toNumber(thresholdText) : null,
        note,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoider style={styles.root}>
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
        <FormField
          label="名前"
          required
          value={name}
          onChangeText={setName}
          placeholder="化成肥料 8-8-8"
          error={nameError}
        />

        <View style={styles.group}>
          <Text style={styles.groupLabel}>分類</Text>
          <View style={styles.chips}>
            {MATERIAL_CATEGORIES.map((option) => {
              const active = category === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(option)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {MATERIAL_CATEGORY_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>
            残り <Text style={styles.optional}>（任意）</Text>
          </Text>
          <View style={styles.row}>
            <TextInput
              style={styles.numberInput}
              value={quantityText}
              onChangeText={setQuantityText}
              placeholder="1.5"
              placeholderTextColor={Colors.inkDim}
              keyboardType="decimal-pad"
              accessibilityLabel="残りの数量"
            />
            <TextInput
              style={styles.unitInput}
              value={unit}
              onChangeText={setUnit}
              placeholder="袋"
              placeholderTextColor={Colors.inkDim}
              accessibilityLabel="単位"
            />
          </View>
          <View style={[styles.chips, styles.unitRow]}>
            {UNIT_SUGGESTIONS.map((option) => (
              <PressableScale
                key={option}
                style={[styles.chip, unit === option && styles.chipActive]}
                onPress={() => setUnit(unit === option ? '' : option)}
              >
                <Text style={[styles.chipText, unit === option && styles.chipTextActive]}>
                  {option}
                </Text>
              </PressableScale>
            ))}
          </View>
          <Text style={styles.hint}>道具のように数えないものは、空のままで構いません。</Text>
        </View>

        {quantity != null ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>残りわずかの目安</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.numberInput}
                value={thresholdText}
                onChangeText={setThresholdText}
                placeholder="0.5"
                placeholderTextColor={Colors.inkDim}
                keyboardType="decimal-pad"
                accessibilityLabel="残りわずかの目安"
              />
              <Text style={styles.unitLabel}>{unit || ''}以下でお知らせ</Text>
            </View>
            <Text style={styles.hint}>
              お知らせは 1 日 1 回、まとめて届きます。使うたびには鳴りません。
            </Text>
          </View>
        ) : null}

        <FormField
          label="メモ"
          value={note}
          onChangeText={setNote}
          placeholder="開封済み / ○○ホームセンターで購入 など"
          multiline
          style={styles.noteInput}
        />

        {footer}
      </ScrollView>
    </KeyboardAvoider>
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
  group: { marginBottom: 18 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  optional: { color: Colors.inkDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitRow: { marginTop: 10 },
  numberInput: {
    width: 92,
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
  unitInput: {
    width: 88,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Typography.size.base,
    color: Colors.ink,
  },
  unitLabel: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderRadius: 14, borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  hint: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: 8, lineHeight: 18 },
  // FormField が枠込みの高さとして扱う（3 行ぶん）。numberOfLines は付けない
  noteInput: { minHeight: 98, textAlignVertical: 'top' },
});

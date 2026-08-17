/**
 * 収穫の記録・編集フォーム（R06 / WBS 2.1）
 *
 * **写真が主役。** 画面の一番上に写真、その下に日付、数量は最後に置く。
 * 数量を上に置くと「数えないと記録できない」ように見えて、記録そのものが止まる。
 *
 * 新規のときはカメラを自動で起動する（autoCapture）。R06 の
 * 「収穫 → カメラ → 保存の最短 3 タップ」を満たすにはシートを挟めない。
 * 撮影を取り消してもフォームには留まるので、ギャラリーにも切り替えられる。
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { expoImagePickerPhotoCaptureAdapter } from '../services/expo-photo-capture.adapter';
import { HARVEST_UNIT_LABEL, HARVEST_UNITS } from '../services/harvest.service';
import { capturePhoto } from '../services/photo-capture.service';
import { persistGardenPhotos } from '../services/photo-storage.service';
import type { HarvestUnit } from '../services/types';
import { CARE_LOG_DATE_QUICK_PICKS, DateField } from './DateField';
import { FormField } from './FormField';
import { KeyboardAvoider } from './KeyboardAvoider';
import { PhotoGridField } from './PhotoGridField';
import { PressableScale } from './PressableScale';

export interface HarvestFormValues {
  harvestedAt: string;
  quantity: number | null;
  unit: HarvestUnit | null;
  note: string;
  photoUris: string[];
}

interface HarvestFormProps {
  initialValues?: Partial<HarvestFormValues>;
  onSubmit: (values: HarvestFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  /** 開いた直後にカメラを出す（新規記録のとき） */
  autoCapture?: boolean;
  footer?: React.ReactNode;
}

export function HarvestForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  autoCapture = false,
  footer,
}: HarvestFormProps) {
  const insets = useSafeAreaInsets();
  const [harvestedAt, setHarvestedAt] = useState(
    initialValues?.harvestedAt ?? new Date().toISOString(),
  );
  const [quantityText, setQuantityText] = useState(
    initialValues?.quantity != null ? String(initialValues.quantity) : '',
  );
  const [unit, setUnit] = useState<HarvestUnit | null>(initialValues?.unit ?? null);
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [photoUris, setPhotoUris] = useState<string[]>(initialValues?.photoUris ?? []);
  const [saving, setSaving] = useState(false);

  // 二重起動を防ぐ。再レンダリングのたびにカメラが出ると操作できなくなる
  const capturedOnce = useRef(false);

  useEffect(() => {
    if (!autoCapture || capturedOnce.current) return;
    capturedOnce.current = true;
    void (async () => {
      try {
        const photo = await capturePhoto('camera', expoImagePickerPhotoCaptureAdapter);
        const [path] = await persistGardenPhotos([photo]);
        setPhotoUris((current) => [...current, path]);
      } catch {
        // 取り消し・失敗ともフォームに留まる。ギャラリーから選び直せる
      }
    })();
  }, [autoCapture]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const parsed = Number.parseFloat(quantityText.replace(/[^0-9.]/g, ''));
      const quantity = Number.isFinite(parsed) ? parsed : null;
      await onSubmit({ harvestedAt, quantity, unit, note, photoUris });
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
        <View style={styles.group}>
          <Text style={styles.groupLabel}>写真</Text>
          <PhotoGridField value={photoUris} onChange={setPhotoUris} />
        </View>

        {/* 採った日にさかのぼれるように。アルバム（R07）は収穫日で月ごとに
            並ぶので、ここがずれると写真が違う月に入る */}
        <DateField
          label="収穫日"
          required
          value={harvestedAt}
          onChange={setHarvestedAt}
          quickPicks={CARE_LOG_DATE_QUICK_PICKS}
        />

        <View style={styles.group}>
          <Text style={styles.groupLabel}>
            とれた量 <Text style={styles.optional}>（任意）</Text>
          </Text>
          <View style={styles.quantityRow}>
            <TextInput
              style={styles.quantityInput}
              value={quantityText}
              onChangeText={setQuantityText}
              placeholder="5"
              placeholderTextColor={Colors.inkDim}
              keyboardType="decimal-pad"
              accessibilityLabel="とれた量"
            />
            <View style={styles.units}>
              {HARVEST_UNITS.map((option) => {
                const active = unit === option;
                return (
                  <PressableScale
                    key={option}
                    style={[styles.unitChip, active && styles.unitChipActive]}
                    onPress={() => setUnit(active ? null : option)}
                  >
                    <Text style={[styles.unitText, active && styles.unitTextActive]}>
                      {HARVEST_UNIT_LABEL[option]}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint}>写真だけでも記録できます。</Text>
        </View>

        <FormField
          label="メモ"
          value={note}
          onChangeText={setNote}
          placeholder="初収穫 / 大きく育った など"
          multiline
          numberOfLines={3}
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
  headerSubmit: { color: Colors.harvest, fontWeight: Typography.weight.semibold },
  disabled: { opacity: 0.5 },
  body: { padding: 16, paddingBottom: 48 },
  group: { marginBottom: 16 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  optional: { color: Colors.inkDim },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  quantityInput: {
    width: 88,
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
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  unitChipActive: { borderColor: Colors.harvest, backgroundColor: Colors.harvestSoft },
  unitText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  unitTextActive: { color: Colors.harvest, fontWeight: Typography.weight.medium },
  hint: { fontSize: Typography.size.xs, color: Colors.inkDim, marginTop: 8 },
  // FormField が枠込みの高さとして扱う（3 行ぶん）
  noteInput: { minHeight: 98, textAlignVertical: 'top' },
});

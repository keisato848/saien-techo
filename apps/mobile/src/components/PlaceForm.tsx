/**
 * 場所の登録・編集フォーム（R02 / WBS 1.6）
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { PLACE_KINDS, PLACE_KIND_LABEL } from '../services/place.service';
import { placeFormSchema, type PlaceFormData } from '../validation/place.schema';
import { FormField } from './FormField';
import { KeyboardAvoider } from './KeyboardAvoider';
import { PressableScale } from './PressableScale';

interface PlaceFormProps {
  initialValues?: Partial<PlaceFormData>;
  onSubmit: (data: PlaceFormData) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  /** 編集時のみ表示する追加操作（削除など） */
  footer?: React.ReactNode;
}

export function PlaceForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  footer,
}: PlaceFormProps) {
  const insets = useSafeAreaInsets();
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PlaceFormData>({
    resolver: zodResolver(placeFormSchema),
    defaultValues: { name: '', kind: 'planter', note: '', ...initialValues },
  });

  const kind = watch('kind');
  const submit = handleSubmit(async (data) => {
    await onSubmit(data);
  });

  return (
    <KeyboardAvoider style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.headerAction}>キャンセル</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable onPress={submit} hitSlop={12} disabled={isSubmitting}>
          <Text style={[styles.headerAction, styles.headerSubmit, isSubmitting && styles.disabled]}>
            {isSubmitting ? '保存中' : submitLabel}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="名前"
              required
              value={value}
              onChangeText={onChange}
              placeholder="南の畝 / ベランダ プランターA"
              error={errors.name?.message}
            />
          )}
        />

        <View style={styles.group}>
          <Text style={styles.groupLabel}>種類</Text>
          <View style={styles.chips}>
            {PLACE_KINDS.map((option) => {
              const active = kind === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setValue('kind', option, { shouldValidate: true })}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {PLACE_KIND_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <Controller
          control={control}
          name="note"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="メモ"
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="日当たり良好 / 西日が強い など"
              multiline
              numberOfLines={3}
              style={styles.noteInput}
              error={errors.note?.message}
            />
          )}
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
  // FormField が枠込みの高さとして扱う（3 行ぶん）
  noteInput: { minHeight: 98, textAlignVertical: 'top' },
});

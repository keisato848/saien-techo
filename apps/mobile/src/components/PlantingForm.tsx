/**
 * 栽培の登録・編集フォーム（R01 / WBS 1.5）
 *
 * だいどこの RecipeForm と違い、材料・手順のような可変長の行を持たないので
 * FieldArray は不要。必須は作物名と植え付け日の 2 つだけにして、
 * 「苗を植えた直後に片手で登録できる」ことを優先している。
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Controller, useForm } from 'react-hook-form';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { getPlaceList } from '../services/place.service';
import { getPlantingTagNames } from '../services/planting.service';
import type { PlaceItem } from '../services/types';
import {
  PLANTED_AS_LABEL,
  PLANTED_AS_VALUES,
  plantingFormSchema,
  type PlantingFormData,
} from '../validation/planting.schema';
import { DateField } from './DateField';
import { FormField } from './FormField';
import { PhotoPickerField } from './PhotoPickerField';
import { PressableScale } from './PressableScale';
import { TagSelector } from './TagSelector';

interface PlantingFormProps {
  initialValues?: Partial<PlantingFormData>;
  onSubmit: (data: PlantingFormData) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
}

function todayIso(): string {
  return new Date().toISOString();
}

export function PlantingForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
}: PlantingFormProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PlantingFormData>({
    resolver: zodResolver(plantingFormSchema),
    defaultValues: {
      cropName: '',
      variety: '',
      placeId: null,
      plantedOn: todayIso(),
      plantedAs: 'seedling',
      coverPhotoPath: null,
      note: '',
      tags: [],
      ...initialValues,
    },
  });

  // 場所の追加画面から戻ってきたときに反映したいので useFocusEffect
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setPlaces(await getPlaceList());
        setAvailableTags(await getPlantingTagNames());
      })();
    }, []),
  );

  const selectedTags = watch('tags');
  const selectedPlaceId = watch('placeId');
  const plantedAs = watch('plantedAs');

  const submit = handleSubmit(async (data) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSubmit(data);
    } finally {
      setSaving(false);
    }
  });

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.headerAction}>キャンセル</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable onPress={submit} hitSlop={12} disabled={saving}>
          <Text style={[styles.headerAction, styles.headerSubmit, saving && styles.disabled]}>
            {saving ? '保存中' : submitLabel}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="cropName"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="作物名"
              required
              value={value}
              onChangeText={onChange}
              placeholder="トマト"
              error={errors.cropName?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="variety"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="品種"
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="アイコ"
              error={errors.variety?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="plantedOn"
          render={({ field: { onChange, value } }) => (
            <DateField
              label="植え付け日"
              required
              value={value}
              onChange={onChange}
              error={errors.plantedOn?.message}
            />
          )}
        />

        <View style={styles.group}>
          <Text style={styles.groupLabel}>種から / 苗から</Text>
          <View style={styles.segmented}>
            {PLANTED_AS_VALUES.map((option) => {
              const active = plantedAs === option;
              return (
                <PressableScale
                  key={option}
                  // flex は containerStyle 側に渡す。PressableScale は style を
                  // 内側の Pressable に付けるので、flex:1 だけだと幅が潰れる
                  containerStyle={styles.flexItem}
                  style={[styles.segment, active && styles.segmentActive]}
                  onPress={() => setValue('plantedAs', option, { shouldValidate: true })}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {PLANTED_AS_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>場所</Text>
          {places.length === 0 ? (
            <View style={styles.chips}>
              <Text style={styles.hint}>登録された場所がありません。</Text>
            </View>
          ) : (
            <View style={styles.chips}>
              <PressableScale
                style={[styles.chip, selectedPlaceId == null && styles.chipActive]}
                onPress={() => setValue('placeId', null)}
              >
                <Text style={[styles.chipText, selectedPlaceId == null && styles.chipTextActive]}>
                  未設定
                </Text>
              </PressableScale>
              {places.map((place) => {
                const active = selectedPlaceId === place.id;
                return (
                  <PressableScale
                    key={place.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setValue('placeId', place.id)}
                  >
                    {/* 種別（畝・プランター）は名前に含まれることが多く、
                        併記すると「南の畝 ・畝」のような重複になるため出さない */}
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {place.name}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          )}
          {/* 苗を持ったまま登録している最中に場所が無いと詰むので、ここから作れる */}
          <PressableScale style={styles.addPlace} onPress={() => router.push('/places/new')}>
            <Plus size={14} color={Colors.accent} />
            <Text style={styles.addPlaceText}>場所を追加</Text>
          </PressableScale>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>写真</Text>
          <Controller
            control={control}
            name="coverPhotoPath"
            render={({ field: { onChange, value } }) => (
              <PhotoPickerField
                value={value ?? undefined}
                onChange={(path) => onChange(path ?? null)}
                variant="cover"
              />
            )}
          />
        </View>

        <TagSelector
          selectedTags={selectedTags}
          availableTags={availableTags}
          onToggle={(tag) =>
            setValue(
              'tags',
              selectedTags.includes(tag)
                ? selectedTags.filter((t) => t !== tag)
                : [...selectedTags, tag],
            )
          }
          onAdd={(tag) => {
            if (!selectedTags.includes(tag)) setValue('tags', [...selectedTags, tag]);
            if (!availableTags.includes(tag)) setAvailableTags([...availableTags, tag]);
          }}
        />

        <Controller
          control={control}
          name="note"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="メモ"
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="雨よけをつけた など"
              multiline
              numberOfLines={4}
              style={styles.noteInput}
              error={errors.note?.message}
            />
          )}
        />
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
  body: { padding: 16, paddingBottom: 48, gap: 4 },
  group: { marginBottom: 16 },
  groupLabel: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    marginBottom: 8,
  },
  hint: { fontSize: Typography.size.sm, color: Colors.inkDim },
  segmented: { flexDirection: 'row', gap: 8 },
  flexItem: { flex: 1 },
  segment: {
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  segmentActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  segmentText: { fontSize: Typography.size.base, color: Colors.inkDim },
  segmentTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  addPlace: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  addPlaceText: { fontSize: Typography.size.sm, color: Colors.accent },
  // FormField が枠込みの高さとして扱う（4 行ぶん）
  noteInput: { minHeight: 112, textAlignVertical: 'top' },
});

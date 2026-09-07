/**
 * 作付け計画の登録・編集フォーム（R25 / WBS 4.7）
 *
 * 栽培フォーム（PlantingForm）との違いは 2 つ。
 *
 * 1. **日付ではなく年 + 月を選ぶ。** 計画の段階で日にちは決まらない
 *    （理由は planting-plan.service の冒頭）
 * 2. **作物マスターから選べる。** 栽培の登録は「いま植えた株」を後追いで
 *    書くので手入力で足りるが、計画は「何を植えようか」を決める場面なので、
 *    一覧から選べた方が早い。50 品目を分類（4.19 の crops.category）で
 *    たたんで出す
 *
 * 作物選びのシートに検索欄を置いていないのは、`BottomSheet` が `Modal` で
 * 別ツリーになり、キーボードが選択肢を覆うため（KeyboardAvoider.tsx 参照）。
 * 分類チップなら 1 分類あたり数件まで減るので、指で届く。
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect } from 'expo-router';
import { Sprout } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { CROP_CATEGORY_LABEL, CROP_CATEGORY_ORDER, type CropCategory } from '../db/crop-master';
import { getCropGuideList, type CropGuideListItem } from '../services/crop-guide.service';
import { getPlaceList } from '../services/place.service';
import {
  formatPlannedMonth,
  getPlanMonthSuggestions,
  PLAN_KINDS,
  PLAN_KIND_LABEL,
  type PlanMonthSuggestion,
} from '../services/planting-plan.service';
import type { PlaceItem } from '../services/types';
import {
  plantingPlanFormSchema,
  type PlantingPlanFormData,
} from '../validation/planting-plan.schema';
import { BottomSheet } from './BottomSheet';
import { FormField } from './FormField';
import { KeyboardAvoider } from './KeyboardAvoider';
import { PressableScale } from './PressableScale';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface PlantingPlanFormProps {
  initialValues?: Partial<PlantingPlanFormData>;
  onSubmit: (data: PlantingPlanFormData) => Promise<void>;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
  /** 編集時のみ表示する追加操作（削除など） */
  footer?: React.ReactNode;
}

export function PlantingPlanForm({
  initialValues,
  onSubmit,
  onCancel,
  title,
  submitLabel = '保存',
  footer,
}: PlantingPlanFormProps) {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const thisYear = now.getFullYear();

  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [crops, setCrops] = useState<CropGuideListItem[]>([]);
  const [cropSheetOpen, setCropSheetOpen] = useState(false);
  const [category, setCategory] = useState<CropCategory>('fruit');
  const [suggestions, setSuggestions] = useState<PlanMonthSuggestion[]>([]);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PlantingPlanFormData>({
    resolver: zodResolver(plantingPlanFormSchema),
    defaultValues: {
      cropName: '',
      variety: '',
      placeId: null,
      plannedYear: thisYear,
      plannedMonth: now.getMonth() + 1,
      plannedKind: 'plant',
      note: '',
      ...initialValues,
    },
  });

  const cropName = watch('cropName');
  const plannedYear = watch('plannedYear');
  const plannedMonth = watch('plannedMonth');
  const plannedKind = watch('plannedKind');
  const placeId = watch('placeId');

  // 場所の追加から戻ってきたときに反映したいので useFocusEffect（PlantingForm と同じ）
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setPlaces(await getPlaceList());
        setCrops(await getCropGuideList());
      })();
    }, []),
  );

  // 作物が決まったら、その作物の暦から「まきどき・植えどき」を出す。
  // 当たらない（マスターに無い）作物では候補ゼロ = 月を手で選ぶ形に戻る
  const loadSuggestions = useCallback(async (name: string) => {
    setSuggestions(name.trim() ? await getPlanMonthSuggestions(name) : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSuggestions(cropName);
    }, [loadSuggestions, cropName]),
  );

  const submit = handleSubmit(async (data) => {
    await onSubmit(data);
  });

  const chooseCrop = useCallback(
    (name: string) => {
      setValue('cropName', name, { shouldValidate: true });
      setCropSheetOpen(false);
    },
    [setValue],
  );

  const cropsInCategory = crops.filter((crop) => crop.category === category);

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
        <PressableScale
          style={styles.pickButton}
          onPress={() => setCropSheetOpen(true)}
          accessibilityLabel="作物から選ぶ"
        >
          <Sprout size={16} color={Colors.accentInk} />
          <Text style={styles.pickButtonText}>作物から選ぶ</Text>
        </PressableScale>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>予定</Text>
          <View style={styles.chips}>
            {PLAN_KINDS.map((option) => {
              const active = plannedKind === option;
              return (
                <PressableScale
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setValue('plannedKind', option, { shouldValidate: true })}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {PLAN_KIND_LABEL[option]}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {suggestions.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>暦からの目安</Text>
            <View style={styles.chips}>
              {suggestions.map((suggestion) => (
                <PressableScale
                  key={`${suggestion.kind}-${suggestion.startMonth}`}
                  style={styles.suggestChip}
                  onPress={() => {
                    setValue('plannedKind', suggestion.kind, { shouldValidate: true });
                    setValue('plannedYear', suggestion.year, { shouldValidate: true });
                    setValue('plannedMonth', suggestion.startMonth, { shouldValidate: true });
                  }}
                >
                  <Text style={styles.suggestChipText}>
                    {PLAN_KIND_LABEL[suggestion.kind]}{' '}
                    {suggestion.startMonth === suggestion.endMonth
                      ? `${suggestion.startMonth}月`
                      : `${suggestion.startMonth}〜${suggestion.endMonth}月`}
                  </Text>
                </PressableScale>
              ))}
            </View>
            <Text style={styles.hint}>
              お住まいの地域帯の栽培暦から出した目安です。実際の時期は天気や品種で前後します。
            </Text>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.groupLabel}>いつ</Text>
          <View style={styles.chips}>
            {[thisYear, thisYear + 1].map((year) => {
              const active = plannedYear === year;
              return (
                <PressableScale
                  key={year}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setValue('plannedYear', year, { shouldValidate: true })}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {year === thisYear ? `今年（${year}）` : `来年（${year}）`}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <View style={[styles.chips, styles.monthGrid]}>
            {MONTHS.map((month) => {
              const active = plannedMonth === month;
              return (
                <PressableScale
                  key={month}
                  style={[styles.monthChip, active && styles.chipActive]}
                  onPress={() => setValue('plannedMonth', month, { shouldValidate: true })}
                  accessibilityLabel={`${month}月`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{month}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={styles.hint}>
            {formatPlannedMonth(plannedYear, plannedMonth, now)}の予定にします。日にちは、
            実際に植えたときに決まります。
          </Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>場所</Text>
          {places.length === 0 ? (
            <Text style={styles.hint}>場所はまだありません。あとから決められます。</Text>
          ) : (
            <View style={styles.chips}>
              <PressableScale
                style={[styles.chip, placeId == null && styles.chipActive]}
                onPress={() => setValue('placeId', null, { shouldValidate: true })}
              >
                <Text style={[styles.chipText, placeId == null && styles.chipTextActive]}>
                  決めていない
                </Text>
              </PressableScale>
              {places.map((place) => {
                const active = placeId === place.id;
                return (
                  <PressableScale
                    key={place.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setValue('placeId', place.id, { shouldValidate: true })}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {place.name}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          )}
        </View>

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
          name="note"
          render={({ field: { onChange, value } }) => (
            <FormField
              label="メモ"
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="種を買っておく / 去年より早めに"
              multiline
              numberOfLines={3}
              style={styles.noteInput}
              error={errors.note?.message}
            />
          )}
        />

        {footer}
      </ScrollView>

      <BottomSheet
        visible={cropSheetOpen}
        onClose={() => setCropSheetOpen(false)}
        title="作物から選ぶ"
      >
        <View style={styles.chips}>
          {CROP_CATEGORY_ORDER.map((option) => {
            const active = category === option;
            return (
              <PressableScale
                key={option}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setCategory(option)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {CROP_CATEGORY_LABEL[option]}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        <ScrollView style={styles.cropScroll}>
          {cropsInCategory.length === 0 ? (
            <Text style={styles.hint}>この分類の作物はまだ読み込めていません。</Text>
          ) : (
            cropsInCategory.map((crop) => (
              <PressableScale
                key={crop.cropId}
                style={styles.cropRow}
                onPress={() => chooseCrop(crop.name)}
              >
                <Text style={styles.cropRowName}>{crop.name}</Text>
                {crop.startNow ? <Text style={styles.cropRowBadge}>今月が始めどき</Text> : null}
              </PressableScale>
            ))
          )}
        </ScrollView>
        <Text style={styles.hint}>一覧に無い作物は、上の「作物名」に直接入力してください。</Text>
      </BottomSheet>
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
  monthGrid: { marginTop: 8 },
  // 12 個並べるので、数字だけの正方形に近い形にして 1 行 6 個に収める
  monthChip: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  suggestChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  suggestChipText: { fontSize: Typography.size.sm, color: Colors.accentInk },
  hint: { fontSize: Typography.size.xs, color: Colors.inkDim, lineHeight: 18, marginTop: 8 },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
    marginBottom: 16,
  },
  pickButtonText: { fontSize: Typography.size.sm, color: Colors.accentInk },
  cropScroll: { maxHeight: 260, marginTop: 12 },
  cropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
  cropRowName: { fontSize: Typography.size.base, color: Colors.ink },
  cropRowBadge: { fontSize: Typography.size.xs, color: Colors.accentInk },
  // FormField が枠込みの高さとして扱う（3 行ぶん）
  noteInput: { minHeight: 98, textAlignVertical: 'top' },
});

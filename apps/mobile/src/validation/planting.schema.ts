/**
 * 栽培の登録・編集フォームのバリデーション（R01 / WBS 1.5）
 *
 * レシピと違い必須は「作物名」と「植え付け日」の 2 つだけにしている。
 * 苗を植えた直後に片手で登録できることを優先する要件（R01）のため、
 * 品種・場所・タグ・メモはすべて後から足せる。
 */
import { z } from 'zod';

export const PLANTED_AS_VALUES = ['seed', 'seedling'] as const;
export const PLANTING_ENDED_REASONS = ['harvested', 'died', 'other'] as const;

export const PLANTED_AS_LABEL: Record<(typeof PLANTED_AS_VALUES)[number], string> = {
  seed: '種から',
  seedling: '苗から',
};

export const ENDED_REASON_LABEL: Record<(typeof PLANTING_ENDED_REASONS)[number], string> = {
  harvested: '収穫完了',
  died: '枯れた',
  other: 'その他',
};

/**
 * 未来の日付を弾く。植え付けは「済んだこと」の記録なので、
 * 予定は R17 作付け計画（v1.6）の領分。
 * 端末のタイムゾーンで当日いっぱいまでは許可する。
 */
function isNotInFuture(iso: string): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return parsed.getTime() <= endOfToday.getTime();
}

export const plantingFormSchema = z.object({
  cropName: z.string().min(1, '作物名は必須です').max(30, '30文字以内で入力してください'),
  cropNameReading: z.string().max(30).optional(),
  cropId: z.string().nullable().optional(),
  variety: z.string().max(30, '30文字以内で入力してください').optional(),
  placeId: z.string().nullable().optional(),
  plantedOn: z
    .string()
    .min(1, '植え付け日は必須です')
    .refine((value) => !Number.isNaN(new Date(value).getTime()), '日付の形式が正しくありません')
    .refine(isNotInFuture, '未来の日付は登録できません'),
  plantedAs: z.enum(PLANTED_AS_VALUES),
  coverPhotoPath: z.string().nullable().optional(),
  note: z.string().max(1000, '1000文字以内で入力してください').optional(),
  tags: z.array(z.string()),
});

export type PlantingFormData = z.infer<typeof plantingFormSchema>;

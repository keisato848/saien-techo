/**
 * 作付け計画のフォームのバリデーション（R25 / WBS 4.7）
 *
 * 必須は「作物名」と「予定の年月」だけ。場所も品種も、計画の段階では
 * 決まっていないことの方が多い（決まっていないことを入力させない）。
 *
 * 過去の月は弾かない。**去年から持ち越した計画をそのまま登録できる方が実態に合う**
 * （「去年まけなかったソラマメ」を年をまたいで残す）。時期を過ぎていることは
 * 一覧で「予定の月を過ぎています」と伝える。
 */
import { z } from 'zod';

import { PLAN_KINDS } from '../services/planting-plan.service';

/** 手帳として意味のある範囲。誤入力（西暦 20026 年）を弾くだけの緩い枠 */
export const PLAN_YEAR_MIN = 2020;
export const PLAN_YEAR_MAX = 2100;

export const plantingPlanFormSchema = z.object({
  cropName: z.string().min(1, '作物名は必須です').max(30, '30文字以内で入力してください'),
  variety: z.string().max(30, '30文字以内で入力してください').optional(),
  placeId: z.string().nullable().optional(),
  plannedYear: z
    .number()
    .int()
    .min(PLAN_YEAR_MIN, '年が正しくありません')
    .max(PLAN_YEAR_MAX, '年が正しくありません'),
  plannedMonth: z.number().int().min(1, '月を選んでください').max(12, '月を選んでください'),
  plannedKind: z.enum(PLAN_KINDS),
  note: z.string().max(500, '500文字以内で入力してください').optional(),
});

export type PlantingPlanFormData = z.infer<typeof plantingPlanFormSchema>;

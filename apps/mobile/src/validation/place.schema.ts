/**
 * 場所の登録・編集フォームのバリデーション（R02 / WBS 1.6）
 */
import { z } from 'zod';

import { PLACE_KINDS } from '../services/place.service';

export const placeFormSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(30, '30文字以内で入力してください'),
  kind: z.enum(PLACE_KINDS),
  note: z.string().max(200, '200文字以内で入力してください').optional(),
});

export type PlaceFormData = z.infer<typeof placeFormSchema>;

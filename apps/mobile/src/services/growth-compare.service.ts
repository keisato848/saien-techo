import { elapsedDaysFrom, getPlantingDetail } from './planting.service';
import { getTimeline } from './garden-timeline.service';

/**
 * 成長の見比べ（R16 / WBS 4.4）。
 *
 * **新しいクエリを足さない。** 栽培にぶら下がる写真は既に
 * `getTimeline({ plantingId })` が作業ログ・収穫の両方から集めているので、
 * それを古い順に並べ直して「何日目の写真か」を付けるだけ。
 *
 * **AI は使わない。** 要件定義 R16 は「同一栽培の写真を定点比較（2 枚並べ）」で、
 * 「R16 の定点比較は人が目視で比べるところまでで、AI は介在しない」と明記されている。
 * 変化を言葉にする機能は R32 の別立て。
 */
export interface GrowthPhoto {
  /** 表示に使う絶対 URI（photo-path で解決済み） */
  uri: string;
  /** 撮影日ではなく**所有レコードの日時**。photos に撮影日時の列が無いため */
  loggedAt: string;
  /** 植え付けからの日数 */
  elapsedDays: number;
  source: 'care_log' | 'harvest';
  /** 同じ日に複数枚あるとき用の通し番号（key に使う） */
  index: number;
}

/** 見比べに必要な最低枚数 */
export const MIN_COMPARE_PHOTOS = 2;

/**
 * 栽培にぶら下がる写真を**古い順**に返す。
 *
 * 並びを古い順にするのは、見比べが「左＝過去 / 右＝現在」を既定にするため。
 * タイムライン本体は新しい順なので、ここで反転している。
 */
export async function getGrowthPhotos(plantingId: string): Promise<GrowthPhoto[]> {
  const planting = await getPlantingDetail(plantingId);
  if (!planting) return [];

  const entries = await getTimeline({ plantingId });
  const photos: GrowthPhoto[] = [];
  // getTimeline は新しい順。古い順へ反転してから採番する
  for (const entry of [...entries].reverse()) {
    for (const uri of entry.photoUris) {
      photos.push({
        uri,
        loggedAt: entry.loggedAt,
        elapsedDays: elapsedDaysFrom(planting.plantedOn, entry.loggedAt),
        source: entry.type,
        index: photos.length,
      });
    }
  }
  return photos;
}

/**
 * 2 枚の間隔（日）。左右どちらが新しくても正の数を返す。
 */
export function daysBetween(a: GrowthPhoto, b: GrowthPhoto): number {
  return Math.abs(b.elapsedDays - a.elapsedDays);
}

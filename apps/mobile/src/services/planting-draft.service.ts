/**
 * 写真からの栽培登録 — 一括処理（WBS 4.15 / #139・一括は #149）。
 *
 * 「庭を何枚か撮る → 作物ごとの下書きが並ぶ → 直して一括登録」を作る。
 *
 * ## 順序の不変条件（#143 から引き継ぐ）
 *
 * **サーバーへ送ってよいのは、リワードで得た残高を 1 枚ぶん消費できたときだけ。**
 * 残高が無ければ**1 件も送らない**。楽観的に先へ送ると、広告が見られなかったときに
 * ただ働きの推論コストだけが出ていく。テストが `invocationCallOrder` で見張る。
 *
 * ## 価値は「判定」ではなく「一括」にある（#149）
 *
 * 栽培が数件のユーザーに 1 枚だけ撮らせても、作物を選ぶボタンを出すのと
 * タップ数が変わらない。**まとめて撮ったときだけ**効くので、入口は複数選択にしてある。
 *
 * ## 写真は保存しない
 *
 * 下書きを作ったら写真は用済み。#149 が最大の障害に挙げたバックアップ肥大は
 * 「写真を残す」案の話で、登録では起こさない。カバー写真にしたい場合だけ
 * ユーザーが明示的に選ぶ（この層では持たない）。
 */
import { isNull } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { consumeIdentifyCredit } from './identify-credit.service';
import { getCropMaster, matchCropMaster, type CropMasterRow } from './crop-match.service';

// 照合はここではなく crop-match.service が持つ（登録フォームからも使うため）。
// 既存の呼び出し元を壊さないよう再エクスポートする
export { getCropMaster, matchCropMaster };
export type { CropMasterRow };
import {
  identifyPlanting,
  PlantingIdentifyError,
  type IdentifyConfidence,
  type IdentifyImageAdapter,
  type IdentifySource,
} from './planting-identify.service';

/** 1 回の一括で選べる上限。多すぎると確認画面が読めなくなる */
export const MAX_IDENTIFY_BATCH = 10;

export type PlantingDraftState = 'pending' | 'identified' | 'failed';

export interface PlantingDraft {
  /** 画面のキー。写真パスは端末内で一意 */
  imageUri: string;
  state: PlantingDraftState;
  /** 作物名（推定 or ユーザーが直したもの） */
  cropName?: string;
  /** 作物マスターに一致したときだけ。読みと科の判定に使う */
  cropId?: string | null;
  cropNameReading?: string | null;
  /** ラベルを読めたときだけ */
  variety?: string;
  plantedAs?: 'seed' | 'seedling';
  confidence?: IdentifyConfidence;
  source?: IdentifySource;
  /** 確認画面に出す一言（読めなかった理由など） */
  note?: string;
  /** 失敗時のメッセージ */
  errorMessage?: string;
}

export interface DraftProgress {
  done: number;
  total: number;
  draft: PlantingDraft;
}

/**
 * 選んだ写真を順に読み取って下書きにする。
 *
 * **残高を 1 枚ぶん消費できたときだけ送る。** 消費は送信の直前
 * （成功時消費にすると、中断して再開するたびに無料で何度も送れてしまう）。
 * 残高が尽きたら、そこから先は `pending` のまま返す（手入力で登録できる）。
 */
export async function identifyPhotoBatch(
  imageUris: string[],
  onProgress?: (progress: DraftProgress) => void,
  deps?: {
    imageAdapter?: IdentifyImageAdapter;
    fetchFn?: typeof fetch;
    master?: CropMasterRow[];
  },
): Promise<PlantingDraft[]> {
  const targets = imageUris.slice(0, MAX_IDENTIFY_BATCH);
  if (targets.length === 0) return [];

  const master = deps?.master ?? (await getCropMaster());
  const knownCrops = master.map((row) => row.name);
  const drafts: PlantingDraft[] = [];

  for (const imageUri of targets) {
    // **ここが不変条件。** 残高が無ければ送らずに pending のまま置く。
    const paid = await consumeIdentifyCredit();
    if (!paid) {
      drafts.push({ imageUri, state: 'pending' });
      continue;
    }

    let draft: PlantingDraft;
    try {
      const result = await identifyPlanting(
        { imageUri, knownCrops },
        deps?.imageAdapter,
        deps?.fetchFn,
      );
      if (!result.found || !result.cropGuess) {
        draft = {
          imageUri,
          state: 'failed',
          ...(result.note !== undefined && { note: result.note }),
          errorMessage: '作物を読み取れませんでした。手で入力できます。',
        };
      } else {
        const matched = matchCropMaster(result.cropGuess, master);
        draft = {
          imageUri,
          state: 'identified',
          cropName: result.cropGuess,
          cropId: matched.cropId,
          cropNameReading: matched.cropNameReading,
          ...(result.variety !== undefined && { variety: result.variety }),
          ...(result.plantedAs !== undefined && { plantedAs: result.plantedAs }),
          ...(result.cropConfidence !== undefined && { confidence: result.cropConfidence }),
          ...(result.source !== undefined && { source: result.source }),
          ...(result.note !== undefined && { note: result.note }),
        };
      }
    } catch (err) {
      draft = {
        imageUri,
        state: 'failed',
        errorMessage:
          err instanceof PlantingIdentifyError
            ? err.message
            : '読み取りに失敗しました。手で入力できます。',
      };
    }

    drafts.push(draft);
    onProgress?.({ done: drafts.length, total: targets.length, draft });
  }

  return drafts;
}

/** 下書きのうち、実際に登録できるもの（作物名が入っているもの）。 */
export function registrableDrafts(drafts: PlantingDraft[]): PlantingDraft[] {
  return drafts.filter((draft) => Boolean(draft.cropName?.trim()));
}

/** すでに同じ作物が育成中なら、二重登録の注意を出すために名前を返す。 */
export async function findActivePlantingNames(): Promise<string[]> {
  if (!isNativePlatform) return [];
  const db = getDb();
  const rows = await db
    .select({ cropName: schema.plantings.cropName })
    .from(schema.plantings)
    .where(isNull(schema.plantings.endedAt));
  return rows.map((row) => row.cropName);
}

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
 * ## カバー写真は保存する（方針転換・2026-09-02）
 *
 * 以前は「写真は保存しない」だった。#149 が問題にしたのは**毎日の記録写真**
 * （作業ログ・収穫で年 1800 枚・360〜720MB）の肥大の話で、登録の下書きとは
 * 前提が違う。登録はユーザーが選んだ株や苗の写真を **1 件につき 1 枚だけ**
 * カバー写真として保存するので、年間の増分はせいぜい数十枚。#149 の障害は
 * ここには当てはまらない。実機で利用者から「作物名しか取れないなら使い道が
 * ない」と指摘され（2026-09-02）、撮った写真を捨てる理由の方が無くなった。
 * 保存は画面側（`identify.tsx` の `handleSaveAll`）が `photo-storage.service.ts` の
 * `persistGardenPhotos` を使って行う。このサービス層は下書きのデータだけを持ち、
 * ファイル I/O は持たない（既存の層分けを崩さない）。
 *
 * ## 植え付け日も写真から埋める
 *
 * 作物名だけでは「いつ植えたか」が分からず、経過日数（ホームの「あと◯日」）が
 * 登録した瞬間から狂う。撮影日（EXIF・`photo-capture.service.ts`）と、サーバーが
 * 返す生育ステージ推定（`estimatedAgeDays`）から `estimatePlantedOn` で初期値を
 * 出す。サーバーが返さない場合が普通にある契約（自信が無ければ省略）なので、
 * その場合は撮影日をそのまま使う。**必ず直せる**（#139 の共通の作法）。
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
  type GrowthStage,
  type IdentifyConfidence,
  type IdentifyImageAdapter,
  type IdentifySource,
} from './planting-identify.service';

// 生育ステージ・estimatePlantedOn は画面（identify.tsx）からも使うため再エクスポート
export type { GrowthStage };

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
  /** 生育段階。サーバーが株の写真から判定したときだけ入る（自信が無ければ省略） */
  growthStage?: GrowthStage;
  /** 撮影時点で植え付けから約何日か。estimatePlantedOn の入力になる */
  estimatedAgeDays?: number;
  /**
   * 植え付け日の既定値（推定 or ユーザーが直したもの）。ISO 8601。
   * サービス層（identifyPhotoBatch）では埋めない — 撮影日（EXIF）は画面側の
   * `photosByUri` にしか無いため。画面が `estimatePlantedOn` で埋める。
   */
  plantedOn?: string;
  /**
   * plantedOn が推定で決まった理由（例:「開花期と判断 → およそ45日前」）。
   * 確認画面に出し、利用者が的外れな推定に気づけるようにする。
   * ユーザーが手で日付を直したら消す（直した値に「推定」の説明を残さない）。
   */
  plantedOnReason?: string;
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
          ...(result.growthStage !== undefined && { growthStage: result.growthStage }),
          ...(result.estimatedAgeDays !== undefined && {
            estimatedAgeDays: result.estimatedAgeDays,
          }),
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

/** 確認画面の「なぜこの日付か」に出す、生育段階の日本語表記 */
export const GROWTH_STAGE_LABEL: Record<GrowthStage, string> = {
  seedling: '育苗期',
  vegetative: '生育期',
  flowering: '開花期',
  fruiting: '結実期',
  harvest: '収穫期',
};

const DAY_MS = 86_400_000;
/** これより古い推定は信用しない（3年）。植え付け日としての意味を成さない */
const MAX_ESTIMATED_AGE_DAYS = 365 * 3;

export interface PlantedOnEstimate {
  /** ISO 8601 */
  plantedOn: string;
  /** estimatedAgeDays が効いたときだけ入る。「なぜこの日付か」を確認画面へ出す */
  reason?: string;
}

/**
 * 下書きの植え付け日の既定値を出す（純関数・実 DB 不要）。
 *
 * - `estimatedAgeDays` があれば「撮影日 − estimatedAgeDays」
 * - 無ければ撮影日をそのまま使う（EXIF が無ければ呼び出し側が今日を渡す）
 * - 撮影日そのものが未来（端末の時計ズレ等）なら `now` に丸める。
 *   これにより「撮影日 − 正の日数」は必ず過去になり、結果が未来になることはない
 * - `estimatedAgeDays` が 3 年を超えるような極端な値は信用せず、撮影日に丸める
 *   （サーバーの推定を無条件には信じない）
 *
 * 画面はこれを下書きごとの初期値にし、ユーザーが直せばそちらを正とする
 * （返り値の `reason` は「なぜこの初期値か」の説明であって、確定した理由ではない）。
 */
export function estimatePlantedOn(
  draft: Pick<PlantingDraft, 'growthStage' | 'estimatedAgeDays'>,
  photoTakenAt: string,
  now: Date = new Date(),
): PlantedOnEstimate {
  const parsedTakenAt = new Date(photoTakenAt);
  const safeTakenAt = Number.isNaN(parsedTakenAt.getTime()) ? now : parsedTakenAt;
  const takenAt = safeTakenAt.getTime() > now.getTime() ? now : safeTakenAt;

  const ageDays = draft.estimatedAgeDays;
  if (ageDays !== undefined && ageDays > 0 && ageDays <= MAX_ESTIMATED_AGE_DAYS) {
    const estimated = new Date(takenAt.getTime() - ageDays * DAY_MS);
    const stageLabel = draft.growthStage ? GROWTH_STAGE_LABEL[draft.growthStage] : '生育の様子';
    return {
      plantedOn: estimated.toISOString(),
      reason: `${stageLabel}と判断 → およそ${ageDays}日前`,
    };
  }

  return { plantedOn: takenAt.toISOString() };
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

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
import { and, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { getMonthlyGardenWork } from './garden-work.service';
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
/**
 * サーバーへ渡す作物名を選ぶ。
 *
 * **上限 40 はサーバー側の zod と揃えた契約**（`planting-identify.service.ts` の
 * `MAX_KNOWN_CROPS`）。マスターが 4.19 で 50 品目になり、**上限を超えた 10 品目が
 * 落ちるようになった**。落ちる 10 品目が DB の行順で決まっていたので、
 * 「いま撮った写真に写っている可能性が高い作物」が落ちることがあった。
 *
 * 順番を意味のあるものにする:
 *
 * 1. **いま育てている作物** — 庭を撮っているのだから、写っている確率が一番高い
 * 2. **今月が始めどき・採りどきの作物** — 買ってきた苗を撮る場面がこれ
 * 3. 残り（マスターの順＝読み仮名順）
 *
 * 上限を上げるにはだいどこ側（`apps/server` の zod `.max(40)` と
 * `identify-vision.ts` の `MAX_KNOWN_CROPS`）を**先に**デプロイする必要がある。
 * クライアントだけ上げると 41 件以上が 400 で弾かれ、写真登録が全件失敗する。
 * 上げるまでの間、この並べ替えが実質の対策になる。
 */
export function rankKnownCropNames(
  master: CropMasterRow[],
  growingCropIds: ReadonlySet<string>,
  seasonalCropIds: ReadonlySet<string>,
): string[] {
  const rank = (row: CropMasterRow): number => {
    if (growingCropIds.has(row.id)) return 0;
    if (seasonalCropIds.has(row.id)) return 1;
    return 2;
  };
  // 同じ優先度の中はマスターの順（読み仮名順）のまま。並びが毎回変わると
  // 「前回は当たったのに今回は落ちた」が起きて原因を追えなくなる
  return [...master]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map((entry) => entry.row.name);
}

/**
 * 育成中の栽培に付いているマスター作物の id。
 *
 * **取れなくても送信は続ける。** 並べ替えは当たりやすさを上げるための補助で、
 * ここで失敗して写真登録そのものを止める理由が無い（順番が素のマスター順に戻るだけ）。
 */
async function getGrowingCropIds(): Promise<Set<string>> {
  if (!isNativePlatform) return new Set();
  try {
    const rows = await getDb()
      .select({ cropId: schema.plantings.cropId })
      .from(schema.plantings)
      .where(and(isNull(schema.plantings.endedAt), like(schema.plantings.cropId, 'crop-%')));
    return new Set(
      (rows as { cropId: string | null }[])
        .map((row) => row.cropId)
        .filter((cropId): cropId is string => cropId != null),
    );
  } catch {
    return new Set();
  }
}

/** 今月の始めどき・採りどき（地域帯は利用者の設定） */
async function getSeasonalCropIds(): Promise<Set<string>> {
  if (!isNativePlatform) return new Set();
  try {
    const work = await getMonthlyGardenWork();
    return new Set([...work.sow, ...work.plant, ...work.harvest].map((crop) => crop.cropId));
  } catch {
    // 文脈が取れなくても登録は続ける。順番が素のマスター順に戻るだけ
    return new Set();
  }
}

async function selectKnownCropNames(
  master: CropMasterRow[],
  context?: { growingCropIds?: ReadonlySet<string>; seasonalCropIds?: ReadonlySet<string> },
): Promise<string[]> {
  const growing = context?.growingCropIds ?? (await getGrowingCropIds());
  const seasonal = context?.seasonalCropIds ?? (await getSeasonalCropIds());
  return rankKnownCropNames(master, growing, seasonal);
}

export async function identifyPhotoBatch(
  imageUris: string[],
  onProgress?: (progress: DraftProgress) => void,
  deps?: {
    imageAdapter?: IdentifyImageAdapter;
    fetchFn?: typeof fetch;
    master?: CropMasterRow[];
    context?: { growingCropIds?: ReadonlySet<string>; seasonalCropIds?: ReadonlySet<string> };
  },
): Promise<PlantingDraft[]> {
  const targets = imageUris.slice(0, MAX_IDENTIFY_BATCH);
  if (targets.length === 0) return [];

  const master = deps?.master ?? (await getCropMaster());
  const knownCrops = await selectKnownCropNames(master, deps?.context);
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

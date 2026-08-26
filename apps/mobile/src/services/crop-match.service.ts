import { and, eq, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';

/**
 * 作物名を作物マスターへ寄せる。
 *
 * ## なぜ要るか（実機レビュー 2026-08-26）
 *
 * 栽培フォームには**作物名の候補も照合も無かった**。`cropId` が付くのは
 * 作物ガイドの「この作物を育てはじめる」から来たときだけで、
 * **手入力は「トマト」と完全一致させても null のまま**だった。
 *
 * `cropId` が null だと、利用者から見て 3 つが静かに壊れる:
 *
 * - **「つぎの作業」が出ない**（`next-action` は crop_guides に innerJoin し、
 *   さらに `cropId LIKE 'crop-%'` で絞る）。全栽培が自由入力ならカードごと消える
 * - **進行帯が描かれない**。しかも帯の中に描く作業ログのドットも消えるので、
 *   記録しても見た目が何も変わらない
 * - **収穫の既定単位が選ばれない**。単位未選択の数量は合計から静かに除外される
 *
 * 実際にユーザーの端末で「アオジソ」「エダマメ」の 2 件が該当し、
 * 進行帯を出して初めて気づけた（それまで可視化する画面が無かった）。
 *
 * ## 照合の順序
 *
 * 1. 完全一致
 * 2. **別名**（アオジソ → シソ など。下の表）
 * 3. 包含（「ミニトマト」→「トマト」。長い方を優先してより具体的な作物を選ぶ）
 *
 * 当たらなければ null のまま。**自由入力を禁じない** — マスターに無い作物を
 * 育てる自由は残す（R03 の「自由入力できる」を壊さない）。
 */

/**
 * 別名 → マスター名。
 *
 * マスターの 30 作物は正式名で書かれているので、店頭や種袋でよく使う呼び方が
 * 当たらない。`crops` テーブルに別名列を足すのは移行が要るうえ、
 * この表はコードで持てば十分（作物暦と同じくアプリ更新で配る）。
 *
 * **家庭菜園で実際に使われる呼び方だけを入れる。** 学名や地方名は増やさない
 * （誤って別作物へ寄せると、暦も助言も間違ったものが出る）。
 */
export const CROP_NAME_ALIASES: Readonly<Record<string, string>> = {
  アオジソ: 'シソ',
  あおじそ: 'シソ',
  青ジソ: 'シソ',
  青じそ: 'シソ',
  大葉: 'シソ',
  オオバ: 'シソ',
  枝豆: 'エダマメ',
  えだまめ: 'エダマメ',
  ミニトマト: 'トマト',
  プチトマト: 'トマト',
  甘長: 'トウガラシ',
  サヤインゲン: 'インゲン',
  さやいんげん: 'インゲン',
  絹さや: 'サヤエンドウ',
  キヌサヤ: 'サヤエンドウ',
  ネギ: '葉ネギ',
  万能ねぎ: '葉ネギ',
  九条ねぎ: '葉ネギ',
};

export interface CropMasterRow {
  id: string;
  name: string;
  nameReading: string | null;
}

export interface CropMatch {
  cropId: string | null;
  cropNameReading: string | null;
}

/** マスター作物（`crop-` で始まる id）だけを引く。ユーザー作成の作物は対象外 */
export async function getCropMaster(): Promise<CropMasterRow[]> {
  if (!isNativePlatform) return [];
  const db = getDb();
  return db
    .select({
      id: schema.crops.id,
      name: schema.crops.name,
      nameReading: schema.crops.nameReading,
    })
    .from(schema.crops)
    .where(like(schema.crops.id, 'crop-%'));
}

export function matchCropMaster(cropName: string, master: CropMasterRow[]): CropMatch {
  const name = cropName.trim();
  if (!name) return { cropId: null, cropNameReading: null };

  const exact = master.find((row) => row.name === name);
  if (exact) return { cropId: exact.id, cropNameReading: exact.nameReading };

  const aliased = CROP_NAME_ALIASES[name];
  if (aliased) {
    const row = master.find((candidate) => candidate.name === aliased);
    if (row) return { cropId: row.id, cropNameReading: row.nameReading };
  }

  // 「ミニトマト」→「トマト」のように、片方がもう片方を含むケースを拾う。
  // 長い方を先に見て、より具体的な作物を優先する。
  const contains = [...master]
    .sort((a, b) => b.name.length - a.name.length)
    .find((row) => name.includes(row.name) || row.name.includes(name));
  if (contains) return { cropId: contains.id, cropNameReading: contains.nameReading };

  return { cropId: null, cropNameReading: null };
}

/**
 * 保存時にマスターへ寄せる。
 *
 * **画面から渡された `cropId` は信用しない。** 作物名だけ書き換えても
 * `cropId` が追随せず、`cropName='ナス'` なのに `cropId='crop-tomato'` の行ができて
 * **トマトの暦で助言する**不整合が起きていた（編集画面が既存の cropId を
 * 初期値に載せ、名前を変えても触らないため）。名前を正として引き直す。
 */
export async function resolveCropId(cropName: string): Promise<CropMatch> {
  if (!isNativePlatform) return { cropId: null, cropNameReading: null };
  return matchCropMaster(cropName, await getCropMaster());
}

/**
 * 既に登録されている栽培の `cropId` を埋め戻す。
 *
 * 照合を保存時に足しても、**既存の行は保存し直すまで null のまま**で、
 * 「つぎの作業」も進行帯も出ないままになる。起動時に 1 回だけ通す。
 *
 * - **null の行だけ**触る。付いている cropId は動かさない（利用者が
 *   作物ガイド経由で意図的に紐づけたものを上書きしない）
 * - 当たらなければ null のまま。自由入力の栽培は自由入力のまま残す
 * - 冪等。走るたびに同じ結果になる
 *
 * @returns 埋め戻した件数
 */
export async function backfillPlantingCropIds(): Promise<number> {
  if (!isNativePlatform) return 0;

  const db = getDb();
  const rows = await db
    .select({ id: schema.plantings.id, cropName: schema.plantings.cropName })
    .from(schema.plantings)
    .where(isNull(schema.plantings.cropId));
  if (rows.length === 0) return 0;

  const master = await getCropMaster();
  if (master.length === 0) return 0;

  let filled = 0;
  for (const row of rows as { id: string; cropName: string }[]) {
    const matched = matchCropMaster(row.cropName, master);
    if (!matched.cropId) continue;
    await db
      .update(schema.plantings)
      .set({ cropId: matched.cropId, cropNameReading: matched.cropNameReading })
      .where(and(eq(schema.plantings.id, row.id), isNull(schema.plantings.cropId)));
    filled += 1;
  }
  return filled;
}

import { and, eq, isNull, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { updatePlantingFtsIndex } from './fts.service';

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
 * ## 照合の順序（4.19 のレビュー 7 で見直し）
 *
 * 1. 完全一致
 * 2. **どちらとも取れる名前**（「ネギ」「エンドウ」）は寄せずに null。
 *    フォームが候補チップで選び直させる（`ambiguousCropCandidates`）
 * 3. **読みの完全一致**（「とまと」「キュウリ」— カタカナ・ひらがなを揃えて比べる）。
 *    部分一致にすると「いも」が「さといも」に当たるので**完全一致だけ**
 * 4. 別名（アオジソ → シソ、大根 → ダイコン。下の表）
 * 5. 包含（「ミニトマト」→「トマト」）
 *
 * 当たらなければ null のまま。**自由入力を禁じない** — マスターに無い作物を
 * 育てる自由は残す（R03 の「自由入力できる」を壊さない）。
 *
 * **漢字は読みでは拾えない。** 「大根」を `toHiragana` に通しても「だいこん」には
 * ならないので、漢字表記は別名表（4）が本体で、読み（3）はかな入力の補助でしかない。
 */

/** カタカナ → ひらがな。読み仮名と比べるための正規化（作物ガイド一覧も使う） */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 別名 → マスター名。
 *
 * マスターの作物は正式名で書かれているので、店頭や種袋でよく使う呼び方が
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
  万能ねぎ: '葉ネギ',
  九条ねぎ: '葉ネギ',
  // ─── 4.19 第 1 段で足した品目の別名（店頭・種袋の呼び方だけ） ───
  白ネギ: '長ネギ',
  根深ネギ: '長ネギ',
  長ねぎ: '長ネギ',
  エンサイ: '空芯菜',
  クウシンサイ: '空芯菜',
  空心菜: '空芯菜',
  エンツァイ: '空芯菜',
  ロケット: 'ルッコラ',
  青梗菜: 'チンゲンサイ',
  シシトウ: 'トウガラシ',
  ししとう: 'トウガラシ',
  唐辛子: 'トウガラシ',
  青唐辛子: 'トウガラシ',
  鷹の爪: 'トウガラシ',
  二十日大根: 'ラディッシュ',
  ハツカダイコン: 'ラディッシュ',
  生姜: 'ショウガ',
  しょうが: 'ショウガ',
  落花生: 'ラッカセイ',
  ピーナッツ: 'ラッカセイ',
  里芋: 'サトイモ',
  さといも: 'サトイモ',
  韮: 'ニラ',
  にら: 'ニラ',
  茗荷: 'ミョウガ',
  みょうが: 'ミョウガ',
  そら豆: 'ソラマメ',
  空豆: 'ソラマメ',
  西瓜: 'スイカ',
  すいか: 'スイカ',
  絹さや: 'サヤエンドウ',
  キヌサヤ: 'サヤエンドウ',
  いんげん: 'インゲン',
  カラーピーマン: 'パプリカ',
  イタリアンパセリ: 'パセリ',
  // ─── 既存 30 品目の漢字・店頭の呼び方（レビュー 7b・2026-09-08） ───
  // 4.19 で足した 20 品目には別名を用意したのに、**先にあった 30 品目は
  // カタカナの正式名しか持っていなかった**。「大根」「胡瓜」と手で書く人の
  // 栽培だけが cropId 無しで残り、進行帯も「つぎの作業」も出ない。
  // 漢字は読み（toHiragana）では拾えないので、ここが本体になる。
  大根: 'ダイコン',
  青首大根: 'ダイコン',
  蕪: 'カブ',
  人参: 'ニンジン',
  法蓮草: 'ホウレンソウ',
  ほうれん草: 'ホウレンソウ',
  ホウレン草: 'ホウレンソウ',
  小松菜: 'コマツナ',
  春菊: 'シュンギク',
  水菜: 'ミズナ',
  京菜: 'ミズナ',
  白菜: 'ハクサイ',
  玉ねぎ: 'タマネギ',
  玉葱: 'タマネギ',
  大蒜: 'ニンニク',
  茄子: 'ナス',
  ナスビ: 'ナス',
  なすび: 'ナス',
  胡瓜: 'キュウリ',
  南瓜: 'カボチャ',
  苦瓜: 'ゴーヤ',
  ニガウリ: 'ゴーヤ',
  ゴーヤー: 'ゴーヤ',
  馬鈴薯: 'ジャガイモ',
  じゃが芋: 'ジャガイモ',
  薩摩芋: 'サツマイモ',
  さつま芋: 'サツマイモ',
  苺: 'イチゴ',
  紫蘇: 'シソ',
  赤ジソ: 'シソ',
  赤じそ: 'シソ',
  スイートコーン: 'トウモロコシ',
  スナックエンドウ: 'スナップエンドウ',
  モロッコインゲン: 'インゲン',
  スイートバジル: 'バジル',
  小ネギ: '葉ネギ',
  小ねぎ: '葉ネギ',
  青ネギ: '葉ネギ',
};

/**
 * どちらとも取れる名前 → 選ばせる候補。
 *
 * 「ネギ」は葉ネギ（収穫 60 日・周年）と長ネギ（150 日・11〜2 月）で暦がまるで違う。
 * 4.19 で長ネギが増えるまでは葉ネギ固定で通っていたが、いまは**当てずっぽうで
 * 寄せると半分は間違った暦で助言する**ことになる。「エンドウ」も同じで、
 * 包含に落ちると長さ順でスナップエンドウへ機械的に寄っていた。
 *
 * 寄せずに null を返し、フォームが「どちらですか」の候補チップを出す。
 */
export const AMBIGUOUS_CROP_NAMES: Readonly<Record<string, readonly string[]>> = {
  ネギ: ['長ネギ', '葉ネギ'],
  エンドウ: ['サヤエンドウ', 'スナップエンドウ'],
};

/**
 * 包含で寄せてはいけない名前。
 *
 * 「芽キャベツ」はキャベツを含むが**別の作物**（収穫までの日数が倍近く違う）。
 * 別名表で拾えないものが包含に落ちると、暦も「つぎの作業」も別作物のものが出る。
 */
const CONTAINS_DENY: readonly string[] = ['芽キャベツ', 'ロマネスコ', 'そうめんカボチャ'];

/**
 * 逆向きの包含（マスター名が入力を含む）を許す最短の入力。
 *
 * 1〜2 文字だと打ちかけの文字で誤爆する — 「菜」→空芯菜、「ナ」→スナップエンドウ、
 * 「サ」→チンゲンサイ。連作チェック（#186）は打鍵のたびに引くので、
 * 1 文字目で「南の畝では去年…」と誤った警告が出ていた。
 */
const MIN_REVERSE_CONTAINS_LENGTH = 3;

/** 読みで引くための別名の索引（「あおじそ」でも「アオジソ」でも当たる） */
const ALIAS_BY_READING: Readonly<Record<string, string>> = (() => {
  const index: Record<string, string> = {};
  for (const [alias, target] of Object.entries(CROP_NAME_ALIASES)) {
    const key = toHiragana(alias);
    if (!(key in index)) index[key] = target;
  }
  return index;
})();

export interface CropMasterRow {
  id: string;
  name: string;
  nameReading: string | null;
}

export interface CropMatch {
  cropId: string | null;
  cropNameReading: string | null;
}

const NO_MATCH: CropMatch = { cropId: null, cropNameReading: null };

function toMatch(row: CropMasterRow): CropMatch {
  return { cropId: row.id, cropNameReading: row.nameReading };
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

/**
 * どちらとも取れる名前なら候補を返す。取れなければ空配列。
 * フォームはこれが空でないときだけ「どちらですか」を出す。
 */
export function ambiguousCropCandidates(cropName: string): string[] {
  const key = toHiragana(cropName.trim());
  if (!key) return [];
  for (const [name, candidates] of Object.entries(AMBIGUOUS_CROP_NAMES)) {
    if (toHiragana(name) === key) return [...candidates];
  }
  return [];
}

export function matchCropMaster(cropName: string, master: CropMasterRow[]): CropMatch {
  const name = cropName.trim();
  if (!name) return NO_MATCH;

  const exact = master.find((row) => row.name === name);
  if (exact) return toMatch(exact);

  // 迷う名前は寄せない。適当に片方へ倒すと、半分の人に別の作物の暦が出る
  if (ambiguousCropCandidates(name).length > 0) return NO_MATCH;

  const hira = toHiragana(name);

  // 読みは**完全一致だけ**。部分一致にすると「いも」が「さといも」に当たる
  const byReading = master.find(
    (row) => row.nameReading != null && toHiragana(row.nameReading) === hira,
  );
  if (byReading) return toMatch(byReading);

  const aliased = CROP_NAME_ALIASES[name] ?? ALIAS_BY_READING[hira];
  if (aliased) {
    const row = master.find((candidate) => candidate.name === aliased);
    if (row) return toMatch(row);
  }

  if (CONTAINS_DENY.some((denied) => toHiragana(denied) === hira)) return NO_MATCH;

  // 「ミニトマト」→「トマト」。入力がマスター名を含むほうは、長い＝より具体的な
  // マスター名を先に見る
  const forward = [...master]
    .sort((a, b) => b.name.length - a.name.length)
    .find((row) => name.includes(row.name));
  if (forward) return toMatch(forward);

  // 逆向き（マスター名が入力を含む）は打ちかけで誤爆しやすいので、
  // 3 文字以上、かつ 1 件に絞れるときだけ許す
  if (name.length < MIN_REVERSE_CONTAINS_LENGTH) return NO_MATCH;
  const reverse = master.filter((row) => row.name.includes(name));
  return reverse.length === 1 ? toMatch(reverse[0]) : NO_MATCH;
}

/** 候補チップに出す最大件数。指が届く範囲に収める */
const SUGGESTION_LIMIT = 5;
/** 候補を出しはじめる入力の長さ。1 文字だと候補がほぼ全品目になる */
const MIN_SUGGESTION_LENGTH = 2;

/**
 * 入力中の作物名から、マスターの候補を前方一致で返す（レビュー 41）。
 *
 * 名前・読み・別名のどれかに前方一致すれば出す。**当たらなければ空配列**で、
 * 自由入力は禁じない（R03）。名前・読み・別名の順に並べるのは、
 * 打った文字がそのまま名前の頭に来ているものがいちばん確からしいため。
 */
export function suggestCropNames(
  input: string,
  master: CropMasterRow[],
  limit: number = SUGGESTION_LIMIT,
): CropMasterRow[] {
  const name = input.trim();
  if (name.length < MIN_SUGGESTION_LENGTH) return [];
  const hira = toHiragana(name);

  const byName: CropMasterRow[] = [];
  const byReading: CropMasterRow[] = [];
  const byAlias: CropMasterRow[] = [];

  for (const row of master) {
    // 打ち切った名前そのものを候補に出しても選びようがない
    if (row.name === name) continue;
    if (row.name.startsWith(name) || toHiragana(row.name).startsWith(hira)) {
      byName.push(row);
      continue;
    }
    if (row.nameReading != null && toHiragana(row.nameReading).startsWith(hira)) {
      byReading.push(row);
      continue;
    }
    const hit = Object.entries(CROP_NAME_ALIASES).some(
      ([alias, target]) =>
        target === row.name && (alias.startsWith(name) || toHiragana(alias).startsWith(hira)),
    );
    if (hit) byAlias.push(row);
  }

  return [...byName, ...byReading, ...byAlias].slice(0, limit);
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
 * - 照合を強くすると（読み・漢字の別名）、**既存の自由入力の栽培にも遡って効く**
 *
 * @returns 埋め戻した件数
 */
export async function backfillPlantingCropIds(): Promise<number> {
  if (!isNativePlatform) return 0;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.plantings.id,
      cropName: schema.plantings.cropName,
      variety: schema.plantings.variety,
    })
    .from(schema.plantings)
    .where(isNull(schema.plantings.cropId));
  if (rows.length === 0) return 0;

  const master = await getCropMaster();
  if (master.length === 0) return 0;

  let filled = 0;
  for (const row of rows as { id: string; cropName: string; variety: string | null }[]) {
    const matched = matchCropMaster(row.cropName, master);
    if (!matched.cropId) continue;
    await db
      .update(schema.plantings)
      .set({ cropId: matched.cropId, cropNameReading: matched.cropNameReading })
      .where(and(eq(schema.plantings.id, row.id), isNull(schema.plantings.cropId)));
    // **読みを行に書いたら索引にも入れる。** 索引を放っておくと、埋め戻しで
    // 「とまと」が付いた株が検索に出ないままになる（行と索引で読みが食い違う）
    if (matched.cropNameReading) {
      const tags = await db
        .select({ name: schema.tags.name })
        .from(schema.plantingTags)
        .innerJoin(schema.tags, eq(schema.plantingTags.tagId, schema.tags.id))
        .where(eq(schema.plantingTags.plantingId, row.id));
      await updatePlantingFtsIndex(
        row.id,
        row.cropName,
        matched.cropNameReading,
        row.variety,
        (tags as { name: string }[]).map((tag) => tag.name),
      );
    }
    filled += 1;
  }
  return filled;
}

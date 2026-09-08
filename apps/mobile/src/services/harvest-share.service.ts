/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）
 *
 * 「今日はキュウリが 3 本採れた」を、家族の LINE や写真アプリへ 1 タップで渡す。
 * **SNS 投稿機能ではない**（「私設・非 SNS」）。OS の共有シートに載せるところまでで、
 * 送り先も宛先もアプリは知らない。
 *
 * ## 「写真」と「ことば」を別々に渡すのをやめた理由
 *
 * Android の `ACTION_SEND` は写真かことばのどちらか片方しか運べない。
 * React Native の `Share` は Android で `url` を捨てるし（ShareModule.java）、
 * `expo-sharing` は本文を持たない。だから**写真を渡すと、作物名も日付も
 * 「さいえん手帳」も一切付かない 1 枚だけ**が外へ出る。
 * Android 先行のこのアプリでそれをやると、R28 の狙い（何が採れたかが伝わる／
 * アプリ名が露出する）が主要プラットフォームで丸ごと落ちる。
 *
 * そこで**ことばを画像へ焼き込む**。外へ出るのは「写真＋作物名＋数量＋日付＋
 * さいえん手帳」が 1 枚になったカードで、これなら片方しか運べなくても全部伝わる。
 *
 * ## 焼き込みの手段（依存を足さずに済ませる）
 *
 * `react-native-view-shot` は入っていない（ネイティブ依存を増やさない方針）。
 * 代わりに **`react-native-svg` の `toDataURL`** を使う。Android 実装は
 * 画面のキャプチャではなく `Bitmap` を作って `drawChildren` を流し直すので
 * （SvgView.java）、SVG の木さえ組めれば画像が得られる。
 *
 * **既知の落とし穴**: Android の RNSVG `ImageView.draw()` は、写真が Fresco の
 * メモリキャッシュに載っているときしか描かない。載っていなければ読み込みを
 * 始めて**その回は何も描かず**、読み終わったら `onLoad` を投げて再描画する。
 * つまり読み込み前に `toDataURL` を呼ぶと**写真の抜けたカード**が出来る。
 *
 * 対策は 2 つ。
 *
 * 1. **プレビューに出している SVG をそのまま書き出す。** 画面に描かれた時点で
 *    キャッシュに載るので、利用者が共有を押す頃には確実に描ける
 * 2. **`onLoad` が来るまで共有ボタンを押させない**（画面側の責務）。
 *    来ないまま時間切れになったら、写真を諦めて**ことばだけのカード**にする
 *
 * ## 出す前に位置情報を落とす
 *
 * 焼き込んだカードは新しいビットマップなので EXIF を持たない。それでも
 * **プレビューへ渡す前に再エンコードを 1 回通す**（`sanitizeImage`）。
 * 保存時の圧縮（`photo-storage.service`）が fail-closed になる前に保存された
 * 写真や、古い形式のバックアップから復元した写真は原本のまま GPS 座標を
 * 持っている可能性があり、共有は取り消せない外向きの操作だからである。
 * 再エンコードは EXIF の向きも焼き込むので、カードの中で写真が寝るのも防げる。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { and, eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { HARVEST_UNIT_LABEL, HARVEST_UNITS } from './harvest.service';
import { resolvePhotoUris } from './photo-path';
import type { HarvestUnit } from './types';

const PHOTO_OWNER = 'harvest';

/** 共有用に書き出すときの JPEG 品質。保存時（0.8）より高くする — 再エンコードの二重掛けになるため */
export const SHARE_JPEG_QUALITY = 0.9;

/** カードへ焼き込む前に写真を縮める長辺（px）。カードの写真枠は 1080px 相当 */
export const SHARE_PHOTO_MAX_DIMENSION = 1280;

/** キャッシュ内の書き出し先。OS が空き容量に応じて消してよい場所に置く */
const SHARE_DIRECTORY = 'share/';

/** `toDataURL` の待ち切り。返ってこないまま画面を握らせない */
export const CAPTURE_TIMEOUT_MS = 8_000;

// ─── 型 ──────────────────────────────────────────────────────────────────────

/** 共有カード 1 枚分。DB から必要な列だけ集めた読み取り専用のビュー */
export interface HarvestShareCard {
  harvestId: string;
  plantingId: string;
  cropName: string;
  variety: string | null;
  /** ISO 8601 */
  harvestedAt: string;
  quantity: number | null;
  unit: HarvestUnit | null;
  /** カードへ焼き込む 1 枚（先頭の写真）。写真の無い収穫は null */
  photoUri: string | null;
  /** その収穫に付いている写真の枚数。「1 枚だけ載ります」と伝えるために持つ */
  photoCount: number;
}

/**
 * 実際に何を渡したか。画面はこれを見て「カードは書き出せませんでした」を出す。
 * 失敗を黙って飲み込むと、送ったつもりで送れていない事故になる。
 */
export type HarvestShareOutcome = 'card' | 'text';

export interface ShareHarvestOptions {
  /** カードを書き出さず、ことばだけ送る */
  textOnly?: boolean;
  /** プレビューの SVG を PNG の base64 にする。null を返したらことばへ落とす */
  captureCard?: () => Promise<string | null>;
}

/**
 * 共有の実行部。expo と RN に触る部分をここへ寄せ、テストから差し替える。
 * サービス本体（何を渡すかの判断）は純粋に保つ。
 */
export interface HarvestShareAdapter {
  /** 共有シートを開けるか（一部端末・web では開けない） */
  isSharingAvailable: () => Promise<boolean>;
  /** 位置情報を落として、カードへ載せられる形に整える。uri を返す */
  sanitizeImage: (uri: string) => Promise<string>;
  /** 書き出した PNG（base64）を JPEG のファイルにする。uri を返す */
  writeCardImage: (base64: string, fileName: string) => Promise<string>;
  shareFile: (uri: string, dialogTitle: string) => Promise<void>;
  shareText: (message: string) => Promise<void>;
}

// ─── 読み取り ────────────────────────────────────────────────────────────────

function isHarvestUnit(value: string | null): value is HarvestUnit {
  return value !== null && (HARVEST_UNITS as readonly string[]).includes(value);
}

/**
 * 共有カードの材料をまとめて取る。
 *
 * **場所名とメモは持って来ない。** 場所名は「自宅裏の畑」のように住まいが
 * 分かる書き方をされることがあり、メモは本人の覚え書きなので、
 * 外へ出す既定に入れてよい情報ではない。
 */
export async function getHarvestShareCard(harvestId: string): Promise<HarvestShareCard | null> {
  if (!isNativePlatform) return null;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.harvests.id,
      plantingId: schema.harvests.plantingId,
      harvestedAt: schema.harvests.harvestedAt,
      quantity: schema.harvests.quantity,
      unit: schema.harvests.unit,
      cropName: schema.plantings.cropName,
      variety: schema.plantings.variety,
    })
    .from(schema.harvests)
    .innerJoin(schema.plantings, eq(schema.harvests.plantingId, schema.plantings.id))
    .where(eq(schema.harvests.id, harvestId))
    .limit(1);
  if (rows.length === 0) return null;

  const row = rows[0];
  const photoRows = await db
    .select({ localPath: schema.photos.localPath, sortOrder: schema.photos.sortOrder })
    .from(schema.photos)
    .where(and(eq(schema.photos.ownerType, PHOTO_OWNER), eq(schema.photos.ownerId, harvestId)));

  const sorted = [...photoRows].sort(
    (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder,
  );
  const uris = resolvePhotoUris(sorted.map((photo: { localPath: string }) => photo.localPath));

  return {
    harvestId: row.id,
    plantingId: row.plantingId,
    cropName: row.cropName,
    variety: row.variety,
    harvestedAt: row.harvestedAt,
    quantity: row.quantity,
    unit: isHarvestUnit(row.unit) ? row.unit : null,
    photoUri: uris[0] ?? null,
    photoCount: uris.length,
  };
}

// ─── 文言（純関数）──────────────────────────────────────────────────────────

/**
 * 「3個」「1.5kg」。数量が無ければ null（写真だけの収穫は R06 の正常系）。
 *
 * 単位が空でも数だけは出す。「3」だけでも「採れた数」として読めるし、
 * 単位が無いから何も言わないほうが不親切。
 */
export function formatHarvestAmount(
  quantity: number | null,
  unit: HarvestUnit | null,
): string | null {
  if (quantity == null || !Number.isFinite(quantity)) return null;
  // 3 は「3」、1.5 は「1.5」。小数第 2 位で丸めて末尾の 0 を落とす
  const rounded = Number(quantity.toFixed(2));
  return unit ? `${rounded}${HARVEST_UNIT_LABEL[unit]}` : String(rounded);
}

/** 「2026年9月7日」。DateField の表示と同じ形にそろえる */
export function formatHarvestDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 品種があれば「キュウリ（夏すずみ）」。無ければ作物名だけ */
export function formatCropTitle(card: Pick<HarvestShareCard, 'cropName' | 'variety'>): string {
  const variety = card.variety?.trim();
  return variety ? `${card.cropName}（${variety}）` : card.cropName;
}

/**
 * カードの見出しに入る最大文字数。
 *
 * SVG の `<Text>` は折り返しも省略もしてくれない — **枠を超えた分はそのまま
 * 描かれてカードの外へはみ出す**。品種まで入れると「ミニトマト（アイコ）」で
 * 10 文字を超えるので、書き出す前に畳んでおく。
 */
export const CARD_TITLE_MAX_LENGTH = 14;

/** 長い見出しを「…」で畳む。SVG は自動で省略しないので呼び出し側で詰める */
export function truncateForCard(text: string, max = CARD_TITLE_MAX_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * 共有シートへ渡すことば。カードを書き出せなかったときの落とし先であり、
 * 「ことばだけ共有」で送るものでもある。
 *
 * 3 行に固定する — 1 行目が成果、2 行目が日付、3 行目がアプリ名。
 * 3 行目は R28 が獲得チャネルも兼ねるため入れているが、URL は付けない
 * （宣伝色が出るとそもそも共有されなくなる）。
 */
export function formatHarvestShareText(card: HarvestShareCard): string {
  const amount = formatHarvestAmount(card.quantity, card.unit);
  const title = formatCropTitle(card);
  const first = amount ? `${title} ${amount} 収穫しました` : `${title} を収穫しました`;
  const date = formatHarvestDate(card.harvestedAt);

  return [first, date, 'さいえん手帳'].filter((line) => line.length > 0).join('\n');
}

/**
 * 書き出すファイル名。
 *
 * **ASCII だけで作る。** 作物名を入れたほうが受け取り側で分かりやすいが、
 * iOS の `URL(string:)` はパーセントエンコードされていない非 ASCII を弾くので、
 * 「キュウリ.jpg」のような名前は書き出しごと失敗しうる。
 * 作物名はカードの中に焼き込まれているので、ファイル名は日付だけにする。
 */
export function buildShareFileName(card: Pick<HarvestShareCard, 'harvestedAt'>): string {
  const date = new Date(card.harvestedAt);
  const ymd = Number.isNaN(date.getTime())
    ? 'harvest'
    : [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
  return `saien-techo-${ymd}.jpg`;
}

// ─── 書き出し ────────────────────────────────────────────────────────────────

/** react-native-svg の `<Svg>` から使うのはこれだけ。テストから差し替えられるよう最小で持つ */
export interface ShareCardCapture {
  toDataURL: (callback: (base64: string) => void, options?: object) => void;
}

/**
 * プレビューの SVG を PNG（base64）にする。**失敗は例外にせず null で返す。**
 *
 * `toDataURL` はコールバックが返らないことがある（ネイティブ側で例外が出た、
 * ビューが外れた）。共有ボタンを押したまま画面が固まるのが最悪なので、
 * 待ち切りを付けて「カードは出せませんでした」へ落とす。
 */
export function captureShareCard(
  view: ShareCardCapture | null,
  timeoutMs: number = CAPTURE_TIMEOUT_MS,
): Promise<string | null> {
  if (!view) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      view.toDataURL((base64) => {
        // 端末によっては `data:image/png;base64,` が付く。付いていても落とす
        const body = typeof base64 === 'string' ? base64.replace(/^data:[^,]*,/, '') : '';
        finish(body.length > 0 ? body : null);
      });
    } catch {
      finish(null);
    }
  });
}

async function ensureShareDirectory(): Promise<string> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) throw new Error('共有用の一時ファイルを作れませんでした');
  const directory = `${cache}${SHARE_DIRECTORY}`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

export const expoHarvestShareAdapter: HarvestShareAdapter = {
  isSharingAvailable: () => Sharing.isAvailableAsync(),

  async sanitizeImage(uri) {
    // ここを通すのは**再エンコードそのもの**が目的 — EXIF の GPS 座標・
    // 撮影方向・端末名が落ちる（expo/expo#28913）。ついでに大きすぎる原本を
    // 縮めておく（カードの写真枠より大きい画素は捨てるだけになる）
    const context = ImageManipulator.manipulate(uri);
    const original = await context.renderAsync();
    if (Math.max(original.width, original.height) > SHARE_PHOTO_MAX_DIMENSION) {
      context.resize(
        original.width >= original.height
          ? { width: SHARE_PHOTO_MAX_DIMENSION }
          : { height: SHARE_PHOTO_MAX_DIMENSION },
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: SHARE_JPEG_QUALITY,
    });
    return saved.uri;
  },

  async writeCardImage(base64, fileName) {
    const directory = await ensureShareDirectory();
    // toDataURL が返すのは PNG。写真入りだと数 MB になるので JPEG へ落としてから渡す
    const pngUri = `${directory}card.png`;
    await FileSystem.deleteAsync(pngUri, { idempotent: true });
    await FileSystem.writeAsStringAsync(pngUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const rendered = await ImageManipulator.manipulate(pngUri).renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: SHARE_JPEG_QUALITY,
    });

    const destination = `${directory}${fileName}`;
    // 同じ日の収穫を続けて共有すると名前がぶつかる。前の書き出しは捨てる
    await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.copyAsync({ from: saved.uri, to: destination });
    // 中間の PNG は残さない（キャッシュとはいえ数 MB を置きっぱなしにしない）
    await FileSystem.deleteAsync(pngUri, { idempotent: true });
    return destination;
  },

  shareFile: (uri, dialogTitle) =>
    Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle }),

  shareText: async (message) => {
    await Share.share({ message });
  },
};

/**
 * プレビューへ載せる前に写真を安全な形へ整える。**失敗したら null。**
 *
 * null のときは写真を諦めて**ことばだけのカード**にする。位置情報を落とせない
 * 写真をそのまま焼き込むくらいなら、写真を出さないほうがよい。
 */
export async function prepareSharePhoto(
  uri: string,
  adapter: HarvestShareAdapter = expoHarvestShareAdapter,
): Promise<string | null> {
  try {
    return await adapter.sanitizeImage(uri);
  } catch {
    return null;
  }
}

/**
 * 共有シートを開く。**利用者が押したときだけ呼ぶこと**（既定で共有しない）。
 *
 * カードを出せない事情（書き出しに失敗した・共有シートが使えない）は
 * すべて「ことばだけ送る」へ落とす。ここで例外を投げて何も起きないより、
 * 「採れた」が伝わるほうが利用者の目的に近い。呼び出し側は戻り値を見て、
 * カードが落ちたことだけ伝える。
 */
export async function shareHarvestCard(
  card: HarvestShareCard,
  options: ShareHarvestOptions = {},
  adapter: HarvestShareAdapter = expoHarvestShareAdapter,
): Promise<HarvestShareOutcome> {
  const text = formatHarvestShareText(card);

  if (options.textOnly || !options.captureCard) {
    await adapter.shareText(text);
    return 'text';
  }

  if (!(await adapter.isSharingAvailable())) {
    await adapter.shareText(text);
    return 'text';
  }

  let fileUri: string;
  try {
    const base64 = await options.captureCard();
    if (!base64) {
      await adapter.shareText(text);
      return 'text';
    }
    fileUri = await adapter.writeCardImage(base64, buildShareFileName(card));
  } catch {
    await adapter.shareText(text);
    return 'text';
  }

  await adapter.shareFile(fileUri, `${card.cropName}の収穫を共有`);
  return 'card';
}

/**
 * 収穫カードの共有（R28 / WBS 4.10 / #41）
 *
 * 「今日はキュウリが 3 本採れた」を、家族の LINE や写真アプリへ 1 タップで渡す。
 * **SNS 投稿機能ではない**（「私設・非 SNS」）。OS の共有シートに載せるところまでで、
 * 送り先も宛先もアプリは知らない。
 *
 * ## なぜ「画像を合成」しないのか（この設計の要）
 *
 * Issue #41 は「収穫写真＋作物名＋日付の共有用画像を生成する」と書いてある。
 * が、**このアプリには画像へ文字を焼き込む手段が無い**:
 *
 * - `react-native-view-shot` は入っていない（ネイティブ依存を増やさない方針）
 * - `expo-image-manipulator` は拡大縮小・切り抜き・回転だけで、文字も重ね合わせも描けない
 * - `react-native-svg` の `toDataURL` なら理屈の上では作れるが、`<Image>` の
 *   読み込みが非同期で、書き出しの瞬間に写真が入っていない事故が起きうる。
 *   **実機で確かめずに主経路へ置ける方式ではない**
 *
 * そこで**焼き込みをやめ、共有シートへ「写真」と「ことば」を渡す**形にした。
 * カードの見た目はアプリ内のプレビュー（`HarvestShareCardView`）が担い、
 * 外へ出るのは写真とテキスト。合成画像は後日、実機で検証できる手段が
 * 見つかってから足す（docs のとおり「動く小さな実装」を先に出す）。
 *
 * ## 写真とことばを 1 回で渡せるか（プラットフォーム差）
 *
 * - **iOS**: `Share.share({ message, url })` が両方を UIActivityViewController へ渡す
 * - **Android**: `ACTION_SEND` は片方しか運べない。RN の `Share` は `url` を捨てるし
 *   （react-native/Libraries/Share/Share.js）、`expo-sharing` は本文を持たない。
 *   なので **写真を優先**し、ことばだけ送りたい人には別のボタンを出す
 *
 * この差を画面へ漏らさないよう、分岐はこのサービスの中に閉じてある
 * （`HarvestShareAdapter.platform` で注入するのでテストから両方たどれる）。
 *
 * ## 出す前に位置情報を落とす
 *
 * 保存時の圧縮（`photo-storage.service`）が JPEG 再エンコードを通すので、
 * 今の経路で保存された写真に EXIF は残らない。ただし
 * **fail-closed になる前に保存された写真や、古い形式のバックアップから
 * 復元した写真は原本のまま**の可能性がある。共有は端末の外へ出す操作で、
 * 一度出たら取り消せないので、**書き出す直前にもう一度再エンコードする**。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { and, eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { HARVEST_UNIT_LABEL, HARVEST_UNITS } from './harvest.service';
import { resolvePhotoUris } from './photo-path';
import type { HarvestUnit } from './types';

const PHOTO_OWNER = 'harvest';

/** 共有用に書き出すときの JPEG 品質。保存時（0.8）より高くする — 再エンコードの二重掛けになるため */
export const SHARE_JPEG_QUALITY = 0.9;

/** キャッシュ内の書き出し先。OS が空き容量に応じて消してよい場所に置く */
const SHARE_DIRECTORY = 'share/';

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
  /** 共有する 1 枚（先頭の写真）。写真の無い収穫は null */
  photoUri: string | null;
  /** その収穫に付いている写真の枚数。「1 枚だけ送ります」と伝えるために持つ */
  photoCount: number;
}

/**
 * 実際に何を渡したか。画面はこれを見て「写真は送れませんでした」を出す。
 * 失敗を黙って飲み込むと、送ったつもりで送れていない事故になる。
 */
export type HarvestShareOutcome = 'photo-with-text' | 'photo' | 'text';

export interface ShareHarvestOptions {
  /** 写真があっても、ことばだけ送る */
  textOnly?: boolean;
}

/**
 * 共有の実行部。expo と RN に触る部分をここへ寄せ、テストから差し替える。
 * サービス本体（何を渡すかの判断）は純粋に保つ。
 */
export interface HarvestShareAdapter {
  platform: 'ios' | 'android' | 'web';
  /** 共有シートを開けるか（Android の一部端末・web では開けない） */
  isSharingAvailable: () => Promise<boolean>;
  /** 位置情報を落として、共有用の一時ファイルへ置き直す。uri を返す */
  prepareImage: (uri: string, fileName: string) => Promise<string>;
  shareFile: (uri: string, dialogTitle: string) => Promise<void>;
  shareText: (message: string) => Promise<void>;
  /** iOS だけ写真とことばを 1 回で渡せる */
  shareTextWithFile: (message: string, uri: string) => Promise<void>;
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
 * 共有シートへ渡すことば。
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
 * 作物名はことばとプレビューで伝わるので、ファイル名は日付だけにする。
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

// ─── 実行 ────────────────────────────────────────────────────────────────────

async function ensureShareDirectory(): Promise<string> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) throw new Error('共有用の一時ファイルを作れませんでした');
  const directory = `${cache}${SHARE_DIRECTORY}`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

export const expoHarvestShareAdapter: HarvestShareAdapter = {
  platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',

  isSharingAvailable: () => Sharing.isAvailableAsync(),

  async prepareImage(uri, fileName) {
    // 縮小はしない（保存時に長辺 1600px まで落としてある）。
    // ここで通すのは**再エンコードそのもの**が目的 — EXIF の GPS 座標・
    // 撮影方向・端末名が落ちる（expo/expo#28913）
    const context = ImageManipulator.manipulate(uri);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: SHARE_JPEG_QUALITY,
    });

    const directory = await ensureShareDirectory();
    const destination = `${directory}${fileName}`;
    // 同じ日の収穫を続けて共有すると名前がぶつかる。前の書き出しは捨てる
    await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.copyAsync({ from: saved.uri, to: destination });
    return destination;
  },

  shareFile: (uri, dialogTitle) =>
    Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle }),

  shareText: async (message) => {
    await Share.share({ message });
  },

  shareTextWithFile: async (message, uri) => {
    await Share.share({ message, url: uri });
  },
};

/**
 * 共有シートを開く。**利用者が押したときだけ呼ぶこと**（既定で共有しない）。
 *
 * 写真を出せない事情（写真が無い・共有シートが使えない・書き出しに失敗した）は
 * すべて「ことばだけ送る」へ落とす。ここで例外を投げて何も起きないより、
 * 「採れた」が伝わるほうが利用者の目的に近い。呼び出し側は戻り値を見て、
 * 写真が落ちたことだけ伝える。
 */
export async function shareHarvestCard(
  card: HarvestShareCard,
  options: ShareHarvestOptions = {},
  adapter: HarvestShareAdapter = expoHarvestShareAdapter,
): Promise<HarvestShareOutcome> {
  const text = formatHarvestShareText(card);

  if (options.textOnly || !card.photoUri) {
    await adapter.shareText(text);
    return 'text';
  }

  // iOS は RN の Share でファイルごと渡すので expo-sharing の可否は関係ない
  const canShareFile = adapter.platform === 'ios' ? true : await adapter.isSharingAvailable();
  if (!canShareFile) {
    await adapter.shareText(text);
    return 'text';
  }

  let fileUri: string;
  try {
    fileUri = await adapter.prepareImage(card.photoUri, buildShareFileName(card));
  } catch {
    // 写真が消えている・壊れている場合。位置情報を落とせない写真は絶対に出さない
    await adapter.shareText(text);
    return 'text';
  }

  if (adapter.platform === 'ios') {
    await adapter.shareTextWithFile(text, fileUri);
    return 'photo-with-text';
  }

  await adapter.shareFile(fileUri, `${card.cropName}の収穫を共有`);
  return 'photo';
}

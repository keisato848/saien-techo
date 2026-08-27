import * as FileSystem from 'expo-file-system/legacy';

/**
 * 写真パスの正規化。
 *
 * **DB には `documentDirectory` からの相対パスだけを入れる。**
 * 以前は `file:///…/Documents/garden-photos/xxx.jpg` のような絶対パスを
 * そのまま保存していたが、**iOS はアプリのデータコンテナ UUID が
 * 再インストールや端末復元で変わる**ため、バックアップ（JSON）を入れ直すと
 * 全写真のパスが無効になり、画面が真っ白になっていた。
 * Android は `/data/user/0/<package>/files/` でパスが安定するので顕在化しないが、
 * 分岐を持たず両プラットフォームで相対パスに統一する。
 *
 * 使い分け:
 * - **書くとき**（DB へ入れる直前）: `toStoredPhotoPath()`
 * - **読むとき**（画面に渡す・ファイルを触る直前）: `resolvePhotoUri()`
 *
 * 既存の絶対パスは `migrate.ts` の v13 で相対へ書き換える。
 * それでも取りこぼした値のために、両関数とも**絶対パスを渡されても壊れない**
 * ようにしてある（読みは素通し、書きは既知のディレクトリ名から切り出す）。
 */

/** アプリが写真を置くディレクトリ。相対パスはこのいずれかで始まる */
export const PHOTO_DIRECTORIES = [
  'garden-photos/',
  'recipe-photos/',
  'cooking-photos/',
  'backup-photos/',
] as const;

function isAbsolute(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('/') || /^[a-z]+:\/\//i.test(path);
}

/**
 * DB へ入れる正規形（`documentDirectory` からの相対パス）へ直す。
 *
 * 絶対パスが来たら既知のディレクトリ名以降を切り出す。**知らない場所を指す
 * 絶対パスはそのまま返す** — 勝手に切り詰めると復元不能になるため。
 */
export function toStoredPhotoPath(path: string): string {
  for (const directory of PHOTO_DIRECTORIES) {
    const index = path.lastIndexOf(directory);
    if (index >= 0) return path.slice(index);
  }
  return path;
}

export function toStoredPhotoPathOrNull(path: string | null | undefined): string | null {
  return path ? toStoredPhotoPath(path) : null;
}

/**
 * 表示・ファイル操作に使う絶対 URI へ戻す。
 * 既に絶対パス（v13 前に保存された値）ならそのまま返す。
 */
export function resolvePhotoUri(
  stored: string,
  documentDirectory: string | null = FileSystem.documentDirectory,
): string {
  if (isAbsolute(stored)) return stored;
  if (!documentDirectory) return stored;
  return `${documentDirectory}${stored}`;
}

export function resolvePhotoUriOrNull(
  stored: string | null | undefined,
  documentDirectory: string | null = FileSystem.documentDirectory,
): string | null {
  return stored ? resolvePhotoUri(stored, documentDirectory) : null;
}

export function resolvePhotoUris(
  stored: string[],
  documentDirectory: string | null = FileSystem.documentDirectory,
): string[] {
  return stored.map((path) => resolvePhotoUri(path, documentDirectory));
}

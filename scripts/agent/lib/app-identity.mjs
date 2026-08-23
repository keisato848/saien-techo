/**
 * アプリ識別子の単一ソース。
 *
 * パッケージ ID・バンドル ID・ディープリンクスキームは `apps/mobile/app.json` にしか
 * 書かない。各スクリプトへのベタ書きは禁止する。
 *
 * 理由: だいどこから移植した際、e2e・スクショ取得・Play API の各スクリプトに
 * 移植元のアプリ ID とスキームが残り、実行するとだいどこ側の資産（公開中の
 * Play 掲載・端末上のだいどこアプリ）を操作してしまう状態になっていた。参照元を
 * 1 箇所に集約して、同じ取りこぼしが起きないようにする。
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const appJsonPath = join(rootDir, 'apps', 'mobile', 'app.json');

let cached = null;

/**
 * app.json から識別子を読む。
 *
 * @returns {{
 *   packageName: string,
 *   bundleId: string,
 *   scheme: string,
 *   version: string,
 *   versionCode: number,
 *   iosBuildNumber: string,
 *   slug: string,
 * }}
 */
export function appIdentity() {
  if (cached) return cached;

  const expo = JSON.parse(readFileSync(appJsonPath, 'utf8')).expo ?? {};
  const packageName = expo.android?.package;
  const bundleId = expo.ios?.bundleIdentifier;
  const scheme = expo.scheme;

  // 取り違えは実害（他アプリの操作）に直結するため、欠落は握りつぶさず落とす
  if (!packageName) throw new Error('app.json に expo.android.package がありません');
  if (!scheme) throw new Error('app.json に expo.scheme がありません');

  cached = {
    packageName,
    bundleId: bundleId ?? packageName,
    scheme,
    version: expo.version ?? '0.0.0',
    versionCode: expo.android?.versionCode ?? 0,
    // iOS の buildNumber は文字列（ASC の builds.version と同じ型で比較する）
    iosBuildNumber: String(expo.ios?.buildNumber ?? ''),
    slug: expo.slug ?? '',
  };
  return cached;
}

/** Android のアプリケーション ID（例: com.saientecho.app） */
export function androidPackage() {
  return appIdentity().packageName;
}

/** iOS のバンドル ID */
export function iosBundleId() {
  return appIdentity().bundleId;
}

/** ディープリンクのスキーム（例: saientecho）。`://` は含まない */
export function deepLinkScheme() {
  return appIdentity().scheme;
}

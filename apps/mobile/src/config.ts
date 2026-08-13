/**
 * App-wide configuration
 * SERVER_BASE_URL: Hono API server endpoint
 */
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// EXPO_PUBLIC_SERVER_URL を設定している場合はそちらを優先
// 未設定時のデフォルト:
//   Web (開発)  → localhost:3000
//   Native      → だいどこの Railway 本番と共用（WBS 決定⑨ — 固定費を増やさない。
//                 さいえん手帳が使うのは /api/v1/garden 配下のみ）
export const SERVER_BASE_URL =
  process.env['EXPO_PUBLIC_SERVER_URL'] ??
  (isWeb ? 'http://localhost:3000' : 'https://daidoko-production.up.railway.app'); // daidoko-ref-ok

export const API_V1 = `${SERVER_BASE_URL}/api/v1`;

// RevenueCat の公開 SDK キー（プラットフォーム別）。
// 未設定なら課金は無効化され、無料枠のみでアプリは完全に動作する（Stub プロバイダ）。
export const REVENUECAT_API_KEY = process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'] ?? '';

// リワード広告（AdMob）の有効化フラグ。既定 false ＝ 広告 UI 非表示で挙動不変。
// 動作確認は EXPO_PUBLIC_ADMOB_ENABLED=true でビルド（app.json のテスト ID で Google テスト広告が出る）。
export const ADMOB_ENABLED = process.env['EXPO_PUBLIC_ADMOB_ENABLED'] === 'true';

// AI 写真レシピの無料枠（1 日あたり）。既定 1。ビルド時に調整可能
// （0 にすると常にペイウォール — 広告フローの E2E 検証にも使う）。
// 注意: Number('') は 0 になるため、未設定・空文字は先に弾く。
const rawFreeLimit = process.env['EXPO_PUBLIC_FREE_DAILY_LIMIT'];
const parsedFreeLimit = rawFreeLimit ? Number(rawFreeLimit) : NaN;
export const FREE_DAILY_LIMIT_CONFIG =
  Number.isInteger(parsedFreeLimit) && parsedFreeLimit >= 0 ? parsedFreeLimit : 1;
// ── 広告ユニット ID ─────────────────────────────────────────────────────────
//
// **AdMob のユニットはアプリ（= プラットフォーム）ごとに別物。** iOS でも広告を
// 出す方針にしたので（iOS 決定①・2026-08-13）、無印 = Android・`_IOS` 付き = iOS
// として持ち、実行中のプラットフォームのものへ解決する。
// Android のユニット ID を iOS で使っても配信されない。
export function platformAdUnit(androidId: string | undefined, iosId: string | undefined): string {
  return (Platform.OS === 'ios' ? iosId : androidId) ?? '';
}

/**
 * 公式テストユニットへのフォールバックを許可する（**検証ビルド専用**）。
 *
 * これが無いと、**ユニット ID 未設定の本番ビルドにテスト広告が出る**。
 * 実際、iOS のユニットを作る前に iOS ビルドを回すとこの状態になる
 * （`_IOS` 系が空 → 空文字 → テスト ID へフォールバック）。
 * テスト広告は収益がゼロなだけでなく、本番配信は AdMob のポリシー違反にあたる。
 *
 * そこで**既定は「空なら広告を出さない」**にして、テスト広告を見たいときだけ
 * `EXPO_PUBLIC_ADMOB_ALLOW_TEST_UNITS=true` を明示的に付ける
 * （`.claude/skills/emulator-verify` §2 参照）。本番の eas.json には入れない。
 */
export const ADMOB_ALLOW_TEST_UNITS = process.env['EXPO_PUBLIC_ADMOB_ALLOW_TEST_UNITS'] === 'true';

// リワード広告ユニット ID。
export const ADMOB_REWARDED_UNIT_ID = platformAdUnit(
  process.env['EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID_IOS'],
);

// 起動広告（アプリを開いたときに出す全画面広告）のユニット ID。§8.2 / WBS 3.7。
export const ADMOB_APP_OPEN_UNIT_ID = platformAdUnit(
  process.env['EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID_IOS'],
);

// バナー広告のユニット ID。置くのは**作物ガイド（閲覧型画面）だけ** — 記録導線に
// 広告を挟まない方針（§8.2）。
export const ADMOB_BANNER_UNIT_ID = platformAdUnit(
  process.env['EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID'],
  process.env['EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS'],
);

// **検証用**: 起動広告の頻度制限（猶予 24 時間・60 分間隔・1 日 3 回）を無視する。
// 入れたばかりの端末では猶予に入って広告が出ないため、実機確認で表示そのものを
// 見たいときにだけ使う（EXPO_PUBLIC_ENABLE_SAMPLE_DATA と同じ立て付け）。
// 同意・オンボーディング・有効フラグの判定は**飛ばさない** — そこを飛ばすと
// 確認したい導線そのものが変わってしまう。
export const ADMOB_IGNORE_FREQUENCY = process.env['EXPO_PUBLIC_ADMOB_IGNORE_FREQUENCY'] === 'true';

// BYOK（持ち込みキー）で端末から直接呼ぶ Gemini モデル。サーバー側の既定と揃える。
export const GEMINI_MODEL = process.env['EXPO_PUBLIC_GEMINI_MODEL'] ?? 'gemini-2.5-flash';

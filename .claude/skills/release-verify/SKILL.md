---
name: release-verify
description: リリース前の成果物検証チェック集。成果物の鮮度（versionName/versionCode が app.json と一致し、app.json の最終コミットより新しいこと — scripts/release/check-artifact-version.py）、AAB の 16KB ELF アライメント（scripts/release/check-elf-align.py）、AndroidManifest の権限監査（AD_ID 等）、アップグレードインストール検証（既存データ維持）、config plugin 注入のサイレント no-op 確認。
---

# リリース前 成果物検証

> **さいえん手帳の値で運用中**（2026-08-12 の v1.0 提出で §2・§6 を実施）。

`release-play`（提出フロー）から呼ばれる検証の詳細。**バリデーション拒否では versionCode は未消費**
（同じ番号で再提出できる）ので、拒否を恐れず提出前にここで潰す。

## 0. 成果物の鮮度 — 「検証している物は、いま出す版か」（**最初に回す**）

```bash
python scripts/release/check-artifact-version.py <app-release.aab|apk>
# versionName / versionCode が apps/mobile/app.json と一致し、app.json の最終コミットより
# 新しければ PASS（exit 0）。不一致・古い成果物は exit 1、読めない環境は exit 2
```

**1.1（2026-08-22）で、監視を「AAB の存在」にしたため 8/14 の古い AAB（v1.0.0）を拾い、
§1・§2・§6 をそれに対して回して「PASS」と報告した。** 本命のビルドは同時実行で壊れていた。
以下の検証はすべて**この手順 0 が通った成果物**に対して行う。
`submit-play-release.mjs` も送信前に同じチェックを走らせる（単一ソース＝この .py）。

## 1. 16KB ELF アライメント（Android 15+ 必須）

```bash
python scripts/release/check-elf-align.py <app-release.aab|apk|dir>
# arm64-v8a / x86_64 の全 .so で PT_LOAD p_align >= 0x4000 = PASS（1.3.0 実績: 42/42）
```

**内部テストでは検出されず、製品版昇格時に初めて拒否される**（10004 で実発生）— 必ず提出前にローカル検証。

## 2. AndroidManifest 権限監査（特に AD_ID）

```bash
# AAB から manifest を確認（bundletool or aapt2。単純確認なら unzip + strings でも可）
unzip -p <aab> base/manifest/AndroidManifest.xml | strings | grep -i permission
```

- **広告なしリリース**: `com.google.android.gms.permission.AD_ID` が**無い**こと（app.json blockedPermissions が効いているか）
- **広告ありリリース**: AD_ID が**有る**こと＋Play の広告申告・データセーフティと一致（不一致は提出拒否の実績）
- `ACCESS_ADSERVICES_*` 系は SDK 由来で無害（申告不要）

## 3. アップグレードインストール検証（既存ユーザー保護）

新バージョンを「クリーンインストール」だけで検証しない。**旧バージョン→新バージョンの上書き**で:

```powershell
# 旧版がインストール済みの端末/エミュレータに
adb install -r <new.apk>   # -r 必須（データ維持）
```

- 既存の SQLite データ（栽培・作業ログ・収穫・資材・写真）が残り、マイグレーション
  （migrate.ts の `CURRENT_SCHEMA_VERSION` / ADD_COLUMN_MIGRATIONS）が正常に走ること
- 署名が一致していること（EAS 鍵 76:BA:… ↔ ローカル release 鍵は別物。混在時は install が失敗する）
- **`install -r` のあとは `adb shell am force-stop <pkg>` してから触る。** 写真ピッカーなどの
  Activity 結果待ちを抱えたまま入れ替えると、新プロセスで `launchImageLibraryAsync` が
  即座に「写真を選べませんでした」で失敗する（1.3.0 実機確認・2026-09-03）。アプリの
  バグに見えるが入れ替え手順の副作用。強制終了→再起動で解消する

## 4. config plugin 注入の確認（サイレント no-op 対策）

Expo config plugin のネイティブ注入は**アンカー文字列の不一致で黙って no-op になる**
（だいどこで OCR が EAS ビルド 4 世代連続で壊れていた実績）。plugins/ を変更したリリースでは:

1. クリーン prebuild: `pnpm --filter mobile exec expo prebuild --platform android --clean`
   （またはビルドスクリプトの `--prebuild`）
2. 注入結果を grep で確認。**現行の plugin と、その注入先**:

   | plugin                      | 注入先                     | 確認する文字列                                     |
   | --------------------------- | -------------------------- | -------------------------------------------------- |
   | `withSaienUploadSigning.js` | `android/app/build.gradle` | `SAIEN_UPLOAD_STORE_FILE` / `bundleRelease` ゲート |
   | `withKotlinMetadataSkip.js` | Gradle 設定                | packagingOptions の除外                            |

   ```bash
   grep -n "SAIEN_UPLOAD_STORE_FILE" apps/mobile/android/app/build.gradle
   grep -n "bundleRelease" apps/mobile/android/app/build.gradle
   ```

   `withSaienUploadSigning` は**アンカーが外れたら例外を投げる**（黙って no-op しない）。
   他の plugin を足すときも同じ作りにすること。

3. そのビルドを実機/エミュレータで起動し、該当 NativeModule が `NativeModules.<name>` に到達することを確認

## 5. リリースノート（提出前に起草）

Play の「このリリースの新機能」ja-JP を起草してユーザー承認を得る（500字以内・ユーザー向けの言葉で）。

## 6. 個人情報が配布物・ストアから出ないか（DoD 3 / CLAUDE.md §4b）

**判定基準**: 開発者・利用者の個人情報が、①アプリ資源（APK/AAB に同梱される画像・
データ）と②ストア掲載物（スクショ・掲載文・グラフィック）のどちらからも取り出せないこと。

### 6-1. アプリ資源 — 「開発用だから入らない」は誤り

`require('../assets/...')` は **Metro がビルド時に静的解決**する。`isSampleDataEnabled` の
ような**実行時**フラグは同梱を止めない（止まるのは表示だけ）。

```powershell
# 提出する AAB に何の画像が入っているか、実物で確認する
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("<app-release.aab>")
$zip.Entries | Where-Object { $_.FullName -match '\.(jpg|jpeg|png|mp4|m4a)$' -and $_.FullName -match 'assets' } |
  ForEach-Object { "{0}  ({1} bytes)" -f $_.FullName, $_.Length }
$zip.Dispose()
```

出てきた写真・音声は、**利用者が展開すれば中身もメタデータも読める**前提で扱う。

```bash
# EXIF が残っていないか（0 でなければ止める）
python -c "
from PIL import Image, ExifTags
im = Image.open('<file.jpg>')
ex = im.getexif()
print('EXIF:', len(ex), 'GPS:', len(ex.get_ifd(ExifTags.IFD.GPSInfo) or {}))
"
# EXIF 以外の領域に残ることもあるので生バイト列も走査する
grep -a -o -E "GPS|Pixel|Google|Exif|HDR\+" <file.jpg> | sort -u
```

実績（2026-08-12）: サンプル写真 4 枚が `EXPO_PUBLIC_ENABLE_SAMPLE_DATA` **無効**の
リリース AAB の `base/res/drawable-mdpi-v4/` に入っていた。提供時の EXIF には
GPS 座標・標高・撮影方向・Pixel 9a・撮影時刻が含まれていた（除去済みで提出）。
除去手順は `sanitize-user-media` Skill。

### 6-2. ストア掲載物

- **スクリーンショット**: `screencap` 由来の PNG は EXIF を持たないが、**写り込み**を見る
  （実データのサンプルに実名・住所・電話番号・メールが出ていないか）
- **掲載文・リリースノート**: 開発者の氏名・住所・私用メールが混ざっていないか
- **デベロッパー情報**: 無料 + 課金なしなら Play に出るのはメールのみ。
  **有料/アプリ内課金を入れた時点で氏名+住所が公開対象**になる
  （EU DSA のトレーダー扱い。docs/広告・収益化方針.md — v1.5 の 4.3 着手時の判断ポイント）

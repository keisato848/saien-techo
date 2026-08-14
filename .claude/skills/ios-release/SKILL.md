---
name: ios-release
description: iOS（App Store）リリース一式（macOS で実行）。シミュレータでの動作確認 → 掲載スクショ取得 → EAS iOS ビルド → TestFlight → App Store Connect 提出。方針=広告あり・日本のみ配信・ATT なし。
---

# iOS（App Store）リリースパイプライン（macOS 専用）

このスキルは **Mac 上の Claude / 開発者** 向け。Windows では iOS シミュレータ・Xcode が
使えないため、iOS 固有の作業（シミュレータ動作確認・スクショ取得）は Mac 側で行う。
**EAS ビルドと提出自体はクラウドなので Windows からでも回せる。**

全体像は `docs/リリース手順.md` §7、作業分解は `docs/WBS.md` §I。

## 方針（判断ポイント⑩・2026-08-13 確定）

| 項目     | 決定                                                                 |
| -------- | -------------------------------------------------------------------- |
| 広告     | **あり**。起動・リワード・バナーの 3 形式（Android と同一）          |
| 配信地域 | **日本のみ**（栽培暦が日本の気候区分前提）                           |
| 取引者   | EU/英国を含まないので **DSA 取引者申告が発生しない**（住所は非公開） |
| ATT      | **実装しない**。App Privacy は「トラッキングに使用しない」で申告     |
| 課金     | なし（freemium は v1.5 へ据え置き）                                  |

**着手は Android 公開後。** app.json / eas.json を共有するため、審査中に触ると
Android の再提出時に変更が混ざる。

## 0. 前提

- Apple Developer Program **加入済み**（Team `VY7SNHS2BY`）。ASC API キーはだいどこと共用
  （Key ID `8C387NYC2T` / `.p8` は `C:/secure/`・リポジトリ外）
- **EAS プロジェクトはリンク済み**（`@keisato848/saien-techo` / app.json の `extra.eas.projectId`）。
  **Android はローカル gradle + androidpublisher API のまま**で、EAS を使うのは iOS だけ
- Mac に **Xcode**（＋Command Line Tools）、**CocoaPods**、**Node/pnpm**、**EAS CLI**
- **リポジトリルートで** `pnpm install`（`.npmrc` が `node-linker=hoisted`。`apps/mobile` 内では実行しない）

> **`eas init` を再実行するときは `git diff app.json` を必ず見る。** 実際に
> `android.permissions` へ `RECORD_AUDIO`（`blockedPermissions` で塞いでいる権限）が
> 追加された。`extra.eas.projectId` 以外の差分は落とすこと。

### 外部で発行する値（すべて 2026-08-13 に取得・投入済み）

`docs/リリース手順.md` §7-4 / §7-4b が単一ソース。

| 値                                   | 状態                                   |
| ------------------------------------ | -------------------------------------- |
| AdMob iOS アプリ + ユニット 3 種     | 投入済み（app.json / eas.json）        |
| App Store Connect App ID             | `6801141151`（eas.json の `ascAppId`） |
| バンドル ID の Developer Portal 登録 | `com.saientecho.app` 登録済み          |
| iOS 署名クレデンシャル               | 構築済み（有効期限 2027-08-13）        |

**I1〜I7 すべて完了（2026-08-15）。** 1.0（ビルド 3）を App Store 審査へ提出済み。
このスキルの手順は次回リリース（1.1 以降）で再利用する。

> **配布証明書はだいどこと共有。** 失効・再生成すると**両アプリのビルドが通らなくなる**。
> 片方の都合で作り直さないこと（プロファイルはアプリごとに別）。

## 1. シミュレータで動作確認

```bash
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
pnpm --filter mobile exec expo run:ios          # dev クライアントで起動
```

**機能パリティの心配は無い。** ML Kit・OCR・expo-camera は WBS 2.9d で機能ごと
削除済みで、Android 専用のネイティブ依存が残っていない。AI 相談はサーバー経由
（決定⑨）なので iOS でもそのまま動く。**iOS で隠す画面は無い。**

重点的に見るのは **Windows で検証できなかった描画**:

- セーフエリア（ノッチ・ホームインジケータ）に文字やボタンが潜り込まないか
- `borderRadius` が効いているか（Android では四角に落ちる不具合を踏んでいる）
- ボトムシートがジェスチャーバーに飲まれないか
- 横スクロール帯（収穫アルバムの作物フィルタ）が縦に伸びないか
- 通知の許可ダイアログとリマインダーの発火（`expo-notifications`・iOS は channelId 不要）
- バックアップ・復元（`documentDirectory`。iCloud バックアップに**含まれる**のが正）

## 2. 掲載スクリーンショット（自動取得）

```bash
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release
node scripts/release/capture-ios-screenshots.mjs     # 9:41・満充電に固定して取得
```

- 出力 = `docs/store/app-store/phone-screenshots/`
- 主サイズ = 6.9"（iPhone 16 Pro Max = 1320×2868）
- **画面構成と順序は Android と揃える**（ホーム → 栽培一覧 → 栽培詳細 → 収穫アルバム →
  作物ガイド → カレンダー → 資材）。正は `docs/store/google-play/README.md` と
  `update-play-screenshots.mjs` の ORDER 配列。ずらすと 2 ストアで別の顔ができる
- **ストア公開物なのでユーザーに提示して承認を得る**
- アップロードは ASC API で自動化できる（**Windows からで良い**）。取得だけが macOS 必須

## 3. EAS iOS ビルド（クラウド）

```bash
cd apps/mobile
pnpm exec eas build -p ios --profile production
```

- `appVersionSource: local` なので `app.json` の `version` を上げる
- **`ios.buildNumber` は同一バージョン内で一意かつ増加。** `android.versionCode` と
  揃える運用（app.json）。上げ忘れると提出が弾かれる
- `ITSAppUsesNonExemptEncryption: false` 設定済み（輸出コンプライアンス質問を回避）

## 4. TestFlight → 提出（外向きアクション — ユーザー承認を確認）

```bash
pnpm exec eas submit -p ios --profile production --id <BUILD_ID> --non-interactive
```

> **「Something went wrong」を信じない。** だいどこでは失敗表示のまま
> アップロードが成功していた（2026-08-13）。**必ず App Store Connect の
> TestFlight 画面で実物を確認する。** 失敗と誤認して再実行すると、
> 2 回目はビルド番号重複で本当に落ちる。詳細ログは
> `https://expo.dev/accounts/keisato848/projects/saien-techo/submissions/<id>`
> の「Upload to App Store Connect」を展開すると読める（CLI には出ない）。

App Store Connect で設定するもの:

- **App Privacy（栄養ラベル）**: Console UI のみ（API 非対応）。写真／その他のユーザー
  コンテンツ = アプリの機能、**デバイス ID・おおよその位置情報** = サードパーティ広告
  （位置情報は Play の data-safety.md と申告を揃える — 単一ソースは data-safety.md）。
  **すべて「個人情報に関連付けない」「トラッキングに使用しない」**（ATT 未実装・IDFA 非取得のため）
- **配信地域 = 日本のみ**
- スクショ（§2）・名前／サブタイトル／プロモーションテキスト／説明／キーワード／
  カテゴリ（**ライフスタイル(主) + 仕事効率化(副)**。フード＆ドリンクではない）／
  サポート URL は `docs/store/app-store/listing-ja.md` が単一ソース
  （ドラフト済み・2026-08-13。サポート URL はサポート専用 Gist を新設して解決済み）
- 年齢レーティングの質問票（Play の回答をそのまま転記できない。別質問票）。
  **回答方針は `docs/store/app-store/listing-ja.md` §8 にドラフト済み**（想定 4+）。
  ただし **AI 生成コンテンツ系の設問は実フォームを見てから答える** — 推測で埋めない

## 既知の注意

- **メディアマネージャーへ複数枚を一括アップロードすると順序が崩れる。** 並列アップロードの
  完了順に並ぶため（実績: 01→07 を一括で入れたら カレンダー→資材→ホーム… になった）。
  **1 枚ずつ、前の 1 枚の処理を待ってからアップロードする**（投入順が保たれる）
- **バージョンページの 6.5 型枠は 6.9 型（1320×2868）を弾く。** 受理は 1242×2688 /
  2688×1242 / 1284×2778 / 2778×1284 のみ。6.9 型は**メディアマネージャーの
  「6.9インチディスプレイ」枠**へ入れる（6.5 枠は「6.9インチディスプレイを使用」に自動フォールバック）
- **提出前チェックで落ちやすい 2 項目**（1.0 提出時に実際に落ちた）:
  **コンテンツ配信権**（アプリ情報ページ。栽培暦は公的資料ベースの自作データなので
  「サードパーティ製コンテンツを含まない」）と、**バージョンページ側のサインイン情報**
  （テスト情報側とは**別フィールド**。アカウント不要のアプリなので両方ともチェックを外す）

- **ads プラグインの `userTrackingUsageDescription` は ATT の plist キーを注入する。**
  app.json の `react-native-google-mobile-ads` にこのキー（だいどこ由来）が残っていると
  Info.plist に `NSUserTrackingUsageDescription` が入り、ASC の App Privacy ページが
  「トラッキングするデータタイプを指定せよ」と警告して**「トラッキングなし」申告と
  矛盾する**。ATT なし方針では**キーごと削除**する（実績: ビルド 2 で混入 →
  ビルド 3 で除去・2026-08-14）
- **広告ユニット ID はプラットフォームごとに別物。** Android の ID を iOS で使っても
  配信されない。`config.ts` の `platformAdUnit()` が無印 = Android・`_IOS` 付き = iOS
  として解決する
- **未設定のユニットを公式テスト ID へ落とすと本番にテスト広告が出る**（AdMob ポリシー
  違反）。既定は「空なら出さない」。検証で見たいときだけ
  `EXPO_PUBLIC_ADMOB_ALLOW_TEST_UNITS=true` を付ける
- **Apple はアプリアイコンに透過・アルファチャンネルを認めない。**
  `pnpm assets:brand` が `icon.png` を flatten して RGB で書き出す（透過が要る
  アダプティブアイコン前景・スプラッシュは対象外）
- **スクショの iOS サイズは Android と別物**（6.9"）。`docs/store/app-store/` に
  iOS 専用で保管し、`docs/store/google-play/` とは混ぜない
- iOS のローカル release ビルドに Android の `build-android.mjs` のような特別扱いは不要

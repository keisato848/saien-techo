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
- Mac に **Xcode**（＋Command Line Tools）、**CocoaPods**、**Node/pnpm**、**EAS CLI**
- **リポジトリルートで** `pnpm install`（`.npmrc` が `node-linker=hoisted`。`apps/mobile` 内では実行しない）

### 着手前に埋まっている必要がある 3 つの空欄

未設定でもビルドは通り**広告が出ないだけ**だが、提出前には埋める（`docs/リリース手順.md` §7-4）。

1. AdMob iOS アプリ ID → `app.json` の `iosAppId`（**現在はテスト ID のまま**）
2. AdMob iOS ユニット ID × 3 → `eas.json` の `*_UNIT_ID_IOS`
3. App Store Connect の App ID → `eas.json` の `ascAppId`

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
  コンテンツ = アプリの機能、デバイス ID = サードパーティ広告。**すべて「個人情報に
  関連付けない」「トラッキングに使用しない」**（ATT 未実装・IDFA 非取得のため）
- **配信地域 = 日本のみ**
- スクショ（§2）・説明文（`docs/store/` を iOS 向けに調整）・年齢レーティング・
  カテゴリ（**ライフスタイル系**。フード＆ドリンクではない）

## 既知の注意

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

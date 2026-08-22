---
name: emulator-verify
description: Android エミュレータ/実機での画面・機能検証の定型。AVD 準備（DNS・wipe）、検証用ビルド（サンプルデータ/コーチマーク無効/配色切替/無料枠調整）、ディープリンク遷移、スクショ確認、ローカルサーバー E2E、AI 相談用のテスト写真投入まで。広告などネット必須機能の落とし穴込み。
---

# Android エミュレータ/実機 検証の定型

実機操作の細則は `.claude/agents/android-verifier.md`、リリース検証は `release-play` / `release-verify` Skill。
一巡を機械で回すなら `pnpm agent:android:e2e:base`（`e2e/android-e2e.mjs`・実機必須・CI 外）。
**E2E が途中で落ちたら `pnpm agent:android:e2e:restore` を回す** — 後片付けはテストの
最後に置いてあるので、途中で止まると作った栽培・場所が残り、終了させたサンプル株が
終了したままになる。放置すると育成中の株が尽きて起動直後から落ちるようになる。

## 1. エミュレータ準備

```powershell
# AVD 一覧 / 起動（検証は 1080x2400 の saien_e2e_api36 が基準。x86_64 なので --arch x86_64 でビルド）
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd saien_e2e_api36 -no-boot-anim -no-audio -no-snapshot -dns-server 8.8.8.8,1.1.1.1
```

- **`-dns-server 8.8.8.8,1.1.1.1` を必ず付ける**（エミュレータ DNS 死亡の実績。広告 / UMP / AI 相談はネット必須）
- **疎通判定に ping は使えない**（emulator NAT は ICMP 不可）— `dumpsys connectivity` の `IS_VALIDATED` を見る
- クリーン状態が要る検証（初回フロー・シード確認）だけ `-wipe-data`。wipe 直後は SystemUI ANR が出やすい
  （dumpsys で `Application Not Responding` を検出 → 画面 x30%/y57% の「Wait」をタップ。capture スクリプトは自動処理）

**実機（AQUOS SH-RM19s）で回すときは先に画面ロックを解除する。** ロック中は
uiautomator dump が全部失敗し、E2E は 10 本すべて落ちる。`e2e/android-e2e.mjs` は
preflight で検出して即止める（気づかずに 1 分半を捨てた実績・2026-08-12）。

## 2. 検証用ビルドのフラグ

```bash
# すべて EXPO_PUBLIC_* はビルド時焼き込み。組み合わせて使う
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1     # サンプルシード（場所・栽培・作業ログ・収穫・資材 + 写真 4 枚）
EXPO_PUBLIC_DISABLE_COACH_MARKS=1    # コーチマーク非表示（スクショ・回帰確認用）
EXPO_PUBLIC_PALETTE=naedoko          # 配色の実機比較（既定は「若葉」。CLAUDE.md §7）
EXPO_PUBLIC_FREE_LIFETIME_LIMIT=0    # 無料枠0=常時ペイウォール（リワード広告フローの E2E 用。旧名 _FREE_DAILY_LIMIT も可）
EXPO_PUBLIC_ADMOB_ENABLED=true       # 広告有効
EXPO_PUBLIC_ADMOB_ALLOW_TEST_UNITS=true # ユニット未設定のとき公式テスト広告を出す（**検証専用**）
EXPO_PUBLIC_ADMOB_IGNORE_FREQUENCY=true # 起動広告の頻度制限を外す（毎回出したいとき）
node scripts/agent/build-android.mjs --arch x86_64   # app.json/plugins 変更時は --prebuild 必須
```

> **`ADMOB_*` の 3 つは `true` 以外を受け取らない。** `config.ts` が
> `=== 'true'` で見ているため、`=1` と書くと**黙って無効**になる
> （`ADMOB_ENABLED` / `ADMOB_ALLOW_TEST_UNITS` / `ADMOB_IGNORE_FREQUENCY`）。
> `ENABLE_SAMPLE_DATA` と `DISABLE_COACH_MARKS` は `1` でも `true` でも効くので、
> **同じ書き方が全部に通ると思わないこと**。実績: `ALLOW_TEST_UNITS=1` で
> ビルドしてリワードが出ず、広告側を疑って 1 ビルド分を捨てた（2026-08-22）。

インストールは常に `adb install -r`（`-r` なしはローカルデータ消失リスクで hook が ask）。

> **フラグを変えただけでは JS バンドルが作り直されない。** `EXPO_PUBLIC_*` は
> Gradle のタスク入力として追跡されないので、環境変数だけ変えて再ビルドしても
> **古いバンドルが黙って再利用される**。実測（2026-08-14）: `EXPO_PUBLIC_ADMOB_ENABLED=true`
> を付けて再ビルドしたのに、APK 内の `index.android.bundle` が前回と MD5 まで一致し、
> 広告が出ないままだった。**JS を 1 行も変えずにフラグだけ切り替えるときは、
> 先にバンドル成果物を消す:**
>
> ```bash
> rm -rf apps/mobile/android/app/build/generated/assets/createBundleReleaseJsAndAssets \
>        apps/mobile/android/app/build/generated/res/createBundleReleaseJsAndAssets \
>        apps/mobile/android/app/build/intermediates/assets/release
> ```
>
> **APK のサイズ差では判定できない。** Metro は `false`→`!1`・`true`→`!0` と同じ
> 文字数に最小化するため、フラグが効いてもサイズが 1 バイトも変わらないことがある
> （実際に 33,760,738 B で完全一致した）。**バンドルの MD5 を比べること。**

> **`EXPO_PUBLIC_ADMOB_ALLOW_TEST_UNITS` を本番ビルドに入れない。** ユニット ID が
> 未設定のとき公式テスト ID へ落ちる挙動は**検証専用**。本番で落とすとテスト広告が
> 実配信され、AdMob のポリシー違反になる。既定は「空なら広告を出さない」。
> iOS のユニットを作る前に iOS ビルドを回すと、まさにこの状態になる。

> **`EXPO_PUBLIC_ENABLE_SAMPLE_DATA` は同梱を止めない。** これは**実行時**の
> シード可否だけ。`assets/` に置いた画像は Metro が `require()` を**ビルド時に
> 静的解決**するので、フラグが無効でも AAB に入る（サンプル写真 4 枚が
> 実際に入っていた・2026-08-12 確認）。配布物から外すのは 3.13a の仕事。

> **`EXPO_PUBLIC_*` は「付けたつもり」が起こる。焼き込まれたか端末で確かめる。**
> フラグを付けてビルドしたのに**前のビルドの env が入ったバンドルが使われた**
> 実績がある（2026-08-21・原因未特定）。**症状が紛らわしい**: そのときは
> サンプルデータだけが入らず、1 つ前のビルドで指定した広告フラグのほうが
> 効いていた（リワードボタンが出た）。
>
> 疑ったら `apps/mobile/android/app/build/generated/assets/.../index.android.bundle`
> の **MD5 を取り、フラグを変えて再ビルドして変わるか**を見る（env が届いていれば変わる）。
> 直すには同ディレクトリを消してから作り直す。
> **フラグに依存する検証は、フラグが効いていることを画面で確認してから始める。**

## 3. 画面遷移・確認

- 遷移は **ディープリンクが最も堅牢**: `adb shell am start -W -a android.intent.action.VIEW -d "saientecho://<route>" com.saientecho.app`

  | route                                               | 画面                     |
  | --------------------------------------------------- | ------------------------ |
  | 空                                                  | ホーム                   |
  | `plantings` / `plantings/new` / `plantings/<id>`    | 栽培の一覧・登録・詳細   |
  | `plantings/<id>/care-logs/new` / `.../harvests/new` | 作業ログ・収穫の記録     |
  | `plantings/<id>/consult`                            | AI 相談                  |
  | `crops` / `crops/<id>`                              | 作物ガイド（30 作物）    |
  | `harvests`                                          | 収穫アルバム             |
  | `calendar` / `gallery`                              | カレンダー・写真         |
  | `places` / `places/new`                             | 場所の管理・登録         |
  | `materials` / `materials/shopping`                  | 資材在庫・買い物リスト   |
  | `settings` / `region` / `backup`                    | 設定・地域・バックアップ |

- 状態を確定させたいときは事前に `adb shell am force-stop com.saientecho.app`（コールドスタート）
- スクショ: `adb exec-out screencap -p > file.png` → Read で目視。**adb は PowerShell ツールで**（Git Bash は /sdcard を壊す）
- 座標タップは**直前のスクショで座標を確認**（コーチマーク・ANR・通知パネル等のオーバーレイが座標を奪う）

## 4. ローカルサーバー E2E（AI 相談）

```bash
# サーバー起動（.env は自動ロードされない — --env-file 必須）
cd apps/server && pnpm exec tsx --env-file=.env src/index.ts
```

```powershell
adb reverse tcp:3000 tcp:3000        # 端末 localhost:3000 → ホスト（開発検証）
adb reverse --remove-all             # 本番構成検証時は必ず除去（既定 = Railway 本番へ向く）
```

サーバーログの 200 応答（`/api/v1/garden/consult`）で「端末から届いた」ことを裏どりする。
**推論サーバーはだいどこの Railway を意図的に共用している**（決定⑨）。

## 5. テスト写真の投入（AI 相談の E2E）

ギャラリーに画像が要る場合:

```powershell
adb push plant.jpg /sdcard/Pictures/plant.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/plant.jpg
```

写真は**苗・葉・果実など植物が写っているもの**を使う。作物名を偽って送っても
モデルは写真から判断し直す（「ミニトマト」と伝えてダイズの幼苗を送ったところ
「ダイズ（枝豆）の幼苗」と訂正された・2026-08-12 実測）ので、
**推定の検証には写真の中身を正とする**こと。

## 既知の落とし穴まとめ

| 症状                         | 原因と対処                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 広告/UMP/AI 相談が失敗       | エミュレータの DNS 死亡 → `-dns-server` 付きで再起動。ping での判定は不可                                                                                                                                                                                                                            |
| uiautomator dump が全部失敗  | 端末がロック画面 → 解除してから再実行（E2E は preflight で止める）                                                                                                                                                                                                                                   |
| スクショに ANR ダイアログ    | wipe 直後の SystemUI 高負荷 → Wait をタップ、2〜3分待つ                                                                                                                                                                                                                                              |
| タップが効かない             | オーバーレイ（コーチマーク等）が手前 → スクショで確認して先に閉じる                                                                                                                                                                                                                                  |
| ネイティブ変更が反映されない | prebuild していない → `--prebuild`（build スクリプトが警告を出す）                                                                                                                                                                                                                                   |
| 署名不一致で install 失敗    | debug/release・EAS 鍵の混在 → 同一署名のビルドで `-r`、やむを得ない時だけユーザー承認の上アンインストール                                                                                                                                                                                            |
| 入力した文字が別物になる     | `adb shell input text` は**端末の IME を通る**。日本語 IME 有効時は小文字がローマ字かな変換される（`E2EPlace576577` → `E2EPぁせ５７６５７７`・AQUOS で実測。かなに落ちた後は数字まで全角）。**大文字 ASCII と数字だけを送る**。入力自体は成功するので検証側で気づけない — `inputText` が小文字を弾く |

---
name: release-play
description: Google Play へのアプリリリース一式。バージョンバンプ → develop→main リリース PR → AAB ビルド（ローカル署名 / EAS）→ 成果物検証（16KB・権限・個人情報）→ 本番構成の実機 E2E → androidpublisher API で production トラックへ提出。初回提出は draft + Console 送信。
---

# Google Play リリースパイプライン

> **さいえん手帳の値で運用中**（2026-08-12 に v1.0.0 / versionCode 1 を審査提出）。
> 実務の詳細・トラブルシューティングは `docs/リリース手順.md`。

AI 相談のサーバーはだいどこの Railway を共用している（決定⑨）。**サーバー側に変更があるときは
先にだいどこリポジトリで `deploy-server` を回す**（さいえん手帳側にサーバーは無い）。

## 0. ビルド経路は 2 本ある — 先に選ぶ

| 経路                      | 署名                                                 | 使うとき                                                           |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| **ローカル**（v1.0 実績） | `C:/secure/saien-upload.keystore` + Play App Signing | 手元に鍵がある通常時。速い                                         |
| EAS Build                 | EAS 管理鍵                                           | 鍵が手元に無い環境。**証明書がローカル鍵と別物**なので混在させない |

**混在は事故る。** Play App Signing を使っているのでストア配信物は Google 署名になるが、
アップロード鍵が違うと Play が受け付けない。

## 1. 手順（ローカル経路・v1.0 実績）

1. **バンプ**: `apps/mobile/app.json` の `version` / `android.versionCode` を更新
   （app.json が唯一のソース。`android/` は gitignore された prebuild 生成物）
   → feature ブランチ → PR → develop へマージ
2. **リリース PR**: `gh pr create --base main --head develop --title "release: x.y.z (versionCode N)"`
   → `gh pr checks <PR> --watch` → `gh pr merge <PR> --merge`（**develop は削除しない**）
3. **署名と広告の env を通す**（値をチャット・ログに出さない）:
   ```powershell
   $creds = Get-Content "C:\secure\saien-upload-credentials.properties" | Where-Object { $_ -match '=' }
   foreach ($line in $creds) { $k, $v = $line -split '=', 2; Set-Item -Path "env:$k" -Value $v }
   $env:EXPO_PUBLIC_ADMOB_ENABLED = "true"
   # ユニット 3 種は docs/リリース手順.md §5 からコピー
   ```
4. **AAB ビルド**: `node scripts/agent/build-android.mjs --bundle`
   （**生 gradlew は PreToolUse で deny される** — Metro のワークスペース解決で必ず失敗するため）
5. **成果物検証**: `release-verify` スキル（16KB アライメント / 権限 / **個人情報の非公開確認 §6** /
   アップグレードインストール）
6. **本番構成の実機 E2E**（マージ前検証の原則・省略しない）:
   - `adb reverse --remove-all` で localhost ブリッジを排除（API 既定 = だいどこ Railway 本番）
   - 実機で AI 相談を通し、応答が返ることを確認
   - **release ビルドは平文 HTTP を遮断する。** ローカルサーバー相手の E2E はできない
     （`EXPO_PUBLIC_SERVER_URL=http://localhost:3000` で焼いても届かない）
7. **提出**（外向きアクション — ユーザーの明示承認を確認してから）:
   ```bash
   node scripts/release/submit-play-release.mjs --dry-run
   node scripts/release/submit-play-release.mjs            # 新規アプリ = draft
   node scripts/release/submit-play-release.mjs --completed # 公開済みアプリの更新
   ```
8. **初回提出は Console で仕上げる**: draft を載せただけでは審査に入らない。
   「公開の概要」→「変更を審査に送信」（`console-browser-ops` §2）

## 2. 既知の落とし穴

- **新規（未公開）アプリは draft リリースしか作れない。** `status: 'completed'` で
  tracks.update すると commit 時に
  `Only releases with status draft may be created on draft app.` で 400
- **サービスアカウントはアプリ単位で権限が要る。** 新規アプリを作っただけでは
  `The caller does not have permission`（403）。Console の
  ユーザーと権限 → 該当 SA → 「アプリを追加」→ 管理者権限
- **AD_ID**: 広告なしリリースは `app.json android.blockedPermissions` に入れる。
  広告ありなら外して申告と揃える（不一致は提出拒否）。
  **`expo prebuild` は追記・マージしかしない** — 外しても生成済みマニフェストの
  `tools:node="remove"` が残るので `--clean` が要る
- **署名レールは config plugin で入る**（`plugins/withSaienUploadSigning.js`）。
  `android/` は gitignore なので手パッチは prebuild で消える。
  `bundleRelease` は `SAIEN_UPLOAD_*` 未設定だと**意図的に失敗する**（debug 署名の AAB を
  Play へ上げない安全弁）
- **versionCode**: バリデーション拒否では未消費 — 同じ番号で再提出可
- **pre-commit Prettier**: 変更ファイルを `prettier --write` してから commit
- ProGuard マッピング未添付の警告はブロッカーではない（任意）

## 3. 提出後

- 審査は通常 7 日以内（新規アプリは長引くことがある）。Console「公開の概要」とメールを監視
- 公開されたら: `v1.0.0` タグ → AdMob と Play 掲載のリンク → 本番ストア版の実機一巡
  （WBS 3.12b〜e）

# さいえん手帳 — CLAUDE.md

> Claude Code が毎回読むプロジェクト憲法。実装前に必ずこのファイル全体を読むこと。

---

## 1. プロダクト概要

**アプリ名:** さいえん手帳
**コンセプト:** 育てて、記録して、ちゃんと採れる。家庭菜園の手帳とアドバイス
**3 本柱:** 記録(作業ログ・写真) / 収穫(写真アルバム) / アドバイス(栽培暦・次の作業・AI 相談)
**プラットフォーム:** Android 先行 / iOS(React Native + Expo)
**ステージ:** v0.1 Alpha 実装中。**fork 移植は完了**(WBS 1.1)。次は WBS 1.2(だいどこ固有機能の削除)。

だいどこ(C:\Projects\daidoko)のコードベースを移植して開発している。コンセプトは「私設・非 SNS・ローカルファースト」。
**移植直後のため、だいどこ由来のコード(レシピ・買い物・OCR・家族共有など)がまだ残っている。** WBS 1.2 で削除するまでは、既存コードがさいえん手帳の仕様とは無関係な箇所を含む前提で読むこと。

## 2. ドキュメントインデックス(実装前に必ず参照)

| ファイル                       | 内容                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `docs/要件定義.md`             | 決定事項ログ・機能要件(R01〜R33)・収益化・フェーズ         |
| `docs/WBS.md`                  | 作業分解構成・マイルストーン・依存関係                     |
| `docs/ペルソナ・競合分析.md`   | ペルソナ 3 人・利用成立の因果仮説・競合体験マッピング      |
| `docs/インフラ・NW構成設計.md` | サーバー構成・コスト試算・決定事項 D1〜D5(承認済み)        |
| `docs/利用規約.md`             | 利用規約(サービス継続を保証しない旨・栽培アドバイスの免責) |
| `docs/開発ハーネス.md`         | Skill・エージェント・フック・実機検証規約(だいどこ由来)    |

## 3. 計画・進捗管理

- GitHub: `keisato848/saien-techo`(private)
- 進捗: [GitHub Project「さいえん手帳 開発計画」](https://github.com/users/keisato848/projects/3) + Issues(タイトル先頭に WBS 番号)
- マイルストーン: v0.1 Alpha → v0.5 Beta → v1.0 ストア公開 → v1.5 AI・統計 → v1.6 春支度 → v2.0 Backlog
- 着手時は該当 Issue のチェックリストに従い、完了時に Issue をクローズする

## 4. 技術スタック(だいどこ踏襲)

Expo SDK 54 / Expo Router v6 / expo-sqlite + Drizzle ORM / Zustand / TanStack Query v5 / React Hook Form + Zod / Reanimated 3。
サーバーは Hono(AI Vision 推論のみ・ステートレス)。詳細はだいどこの `docs/アーキテクチャ設計.md` を参照し、fork 時に必要な設計書を本リポジトリへ移植すること。

## 5. Git ルール

- ブランチ: **`develop` ベース**。機能は `feat/xxx`、修正は `fix/xxx`
- コミット: Conventional Commits(`feat:` `fix:` `test:` `docs:` `chore:`)
- `main` への直接 push 禁止。リリース時に develop → main の PR
- マージ前に必ずエミュレーター/実機で動作確認する

## 6. ハーネス(daidoko 由来)の注意

`.claude/`(skills・agents・workflows・settings.json のフック配線)と `scripts/agent/` はだいどこからの移植。

- フックは `node scripts/agent/*.mjs` を参照(配線済み)。`pnpm agent:*` スクリプトも移植済み
- アプリ ID・スキーム(`app.json`)は さいえん手帳用に差し替え済み。AdMob/RevenueCat の ID は空 or Google 公式テスト ID のプレースホルダー(WBS 3.7 で実 ID を投入)
- **だいどこ固有の参照が残っている**: ストア掲載素材(`scripts/release/`)、`.claude/workflows/release-readiness.js` のリポジトリ名、OCR config plugin(`withDaidokoOcr`)、DB ファイル名(`daidoko.db`)。WBS 1.2 / 1.3 / 3.8〜3.9 で差し替えること
- release-play / update-store-listing / monetize-golive / promo-video 等のリリース系 skill は、差し替え完了までだいどこの値のまま実行しないこと

## 7. ブランド(未確定 — Q2)

明るい緑基調を想定(だいどこのダーク×金は流用しない)。ロゴ・カラーパレット確定までは仮テーマで実装し、`docs/brand/` 追加後に差し替える。UI 表記は「さいえん手帳」。

## 8. 実装フェーズ(詳細は docs/WBS.md)

| フェーズ       | 内容                                    | 期日目安   |
| -------------- | --------------------------------------- | ---------- |
| v0.1 Alpha(次) | fork・不要機能削除・栽培 CRUD・作業ログ | 2026-08-18 |
| v0.5 Beta      | 収穫(写真)・リマインダー・資材          | 2026-09-15 |
| v1.0           | 栽培暦・次の作業・ストア公開            | 2026-10-13 |
| v1.5           | AI 診断/相談・freemium                  | 2026-11-10 |
| v1.6 春支度    | 作付け計画・去年の今ごろ・共有          | 2027-01-31 |

**注意:** WBS 3.1(栽培暦 30 作物のマスターデータ作成)は最重量タスク。v0.5 期間中から前倒しで並行着手すること。

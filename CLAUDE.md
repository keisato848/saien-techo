# さいえん手帳 — CLAUDE.md

> Claude Code が毎回読むプロジェクト憲法。実装前に必ずこのファイル全体を読むこと。

---

## 1. プロダクト概要

**アプリ名:** さいえん手帳
**コンセプト:** 育てて、記録して、ちゃんと採れる。家庭菜園の手帳とアドバイス
**3 本柱:** 記録(作業ログ・写真) / 収穫(写真アルバム) / アドバイス(栽培暦・次の作業・AI 相談)
**プラットフォーム:** Android 先行 / iOS(React Native + Expo)
**ステージ:** **v1.0.0 を Google Play の審査に提出済み(2026-08-12・公開待ち)。**
WBS 3.1〜3.11 まで全機能完了: 栽培 CRUD・場所・検索・作業ログ・タイムライン・
収穫アルバム・カレンダー・リマインダー・資材在庫・買い物リスト・バックアップ/復元(v2)・
栽培暦(30 作物・出典明記)・「今月の菜園仕事」・作物ガイド・「次の作業」・地域設定・
ホーム統合・**AI 相談(サーバー経由・だいどこ Railway 共用・決定⑨)**・
広告 3 形式(起動/リワード/バナー・実 ID 投入済み)。

**次は T1/T2(テスト整備)と審査対応(WBS 3.12a〜e)。公開までは機能フリーズ。**
リリースの実務は docs/リリース手順.md(署名鍵・掲載 CLI・AAB 提出のレール)。

だいどこ(C:\Projects\daidoko)のコードベースを移植して開発している。コンセプトは「私設・非 SNS・ローカルファースト」。

**だいどこ由来のコードは WBS 2.9(a〜e)で計画的に削除した。** 画面・サービス・
ネイティブ(ML Kit/OCR/expo-camera)・DB テーブルの順に段階削除し、2.9e で
レシピ・食材在庫・買い物・調理記録関連テーブルを DROP、バックアップ形式も
v2 化した(旧 v1 形式のファイルもバックアップ画面から引き続き復元できる)。
だいどこから恒久的に引き継ぐのは User/Family/FamilyMember/Tag/SyncMeta/AppMeta
のみ(tags は栽培のタグ付けに流用)。削除の経緯は docs/WBS.md §2.9、
テーブル定義は docs/データ設計.md を参照。

## 2. ドキュメントインデックス(実装前に必ず参照)

| ファイル                       | 内容                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `docs/要件定義.md`             | 決定事項ログ・機能要件(R01〜R33)・収益化・フェーズ         |
| `docs/WBS.md`                  | 作業分解構成・マイルストーン・依存関係                     |
| `docs/ペルソナ・競合分析.md`   | ペルソナ 3 人・利用成立の因果仮説・競合体験マッピング      |
| `docs/インフラ・NW構成設計.md` | サーバー構成・コスト試算・決定事項 D1〜D5(承認済み)        |
| `docs/利用規約.md`             | 利用規約(サービス継続を保証しない旨・栽培アドバイスの免責) |
| `docs/画面設計.md`             | 配色(若葉)・タイポグラフィ・v0.1 の 3 画面の設計           |
| `docs/データ設計.md`           | ER・テーブル定義・だいどこからの移行方針(WBS 2.9 で完了)   |
| `docs/開発ハーネス.md`         | Skill・エージェント・フック・実機検証規約(だいどこ由来)    |

## 3. 計画・進捗管理

- GitHub: `keisato848/saien-techo`(private)
- 進捗: [GitHub Project「さいえん手帳 開発計画」](https://github.com/users/keisato848/projects/3) + Issues(タイトル先頭に WBS 番号)
- マイルストーン: v0.1 Alpha → v0.5 Beta → v1.0 ストア公開 → v1.5 AI・統計 → v1.6 春支度 → v2.0 Backlog
- 着手時は該当 Issue のチェックリストに従い、完了時に Issue をクローズする

## 4. 技術スタック(だいどこ踏襲)

Expo SDK 54 / Expo Router v6 / expo-sqlite + Drizzle ORM / Zustand / TanStack Query v5 / React Hook Form + Zod / Reanimated 3。
サーバーは Hono(AI Vision 推論のみ・ステートレス)。詳細はだいどこの `docs/アーキテクチャ設計.md` を参照し、fork 時に必要な設計書を本リポジトリへ移植すること。

## 4b. 完了条件(DoD) — WBS 2.4 以降

機能タスクは次の 2 つを満たすまで完了としない(WBS T3)。

1. **画面テスト** — 分岐・サービスへ渡す引数・遷移先を `@testing-library/react-native` で
2. **実機確認** — エミュレータで該当導線を通し、スクリーンショットを PR に残す

**画面テストは実機確認の代わりにならない。** 実機でしか出ない不具合の実績:
`PressableScale` の flex 潰れ / `borderRadius` が効かず四角になる /
ボトムシートがジェスチャーバーに飲まれる / 横スクロール帯が縦にも伸びる。
いずれも react-test-renderer では再現しない。

サービス層は実 SQLite でテストする(`src/test-support/sqlite-test-db.ts`)。
モック実装を並走させない — 実 SQL との乖離が「テストは通るが端末で落ちる」を生む。

## 5. Git ルール

- ブランチ: **`develop` ベース**。機能は `feat/xxx`、修正は `fix/xxx`
- コミット: Conventional Commits(`feat:` `fix:` `test:` `docs:` `chore:`)
- `main` への直接 push 禁止。リリース時に develop → main の PR
- マージ前に必ずエミュレーター/実機で動作確認する

## 6. ハーネス(daidoko 由来)の注意

`.claude/`(skills・agents・workflows・settings.json のフック配線)と `scripts/agent/` はだいどこからの移植。

- フックは `node scripts/agent/*.mjs` を参照(配線済み)。`pnpm agent:*` スクリプトも移植済み
- アプリ ID・スキーム(`app.json`)は さいえん手帳用に差し替え済み。AdMob/RevenueCat の ID は空 or Google 公式テスト ID のプレースホルダー(WBS 3.7 で実 ID を投入)
- **だいどこ固有の参照が残っている**: ストア掲載素材(`scripts/release/`)、`.claude/workflows/release-readiness.js` のリポジトリ名。WBS 3.8〜3.9 で差し替えること
- DB ファイル名(`saien-techo.db`)は WBS 1.5 で差し替え済み。OCR ネイティブモジュール(旧 `plugins/withSaienOcr.js`・`com.daidoko.app.ocr`)はさいえん手帳で使い道が無く、WBS 2.9d で ML Kit・expo-camera ごと削除済み
- `scripts/agent/validate-claude-customizations.mjs` の `foreign-app-identifier` 検査が `apps/` も走査する。だいどこの識別子を書くと pre-commit で止まる(意図的な参照は行末に `daidoko-ref-ok`)
- release-play / update-store-listing / monetize-golive / promo-video 等のリリース系 skill は、差し替え完了までだいどこの値のまま実行しないこと

## 7. ブランド(Q2 — 確定)

配色は**「若葉」に決定**(2026-08-03)。明るい黄緑基調で、だいどこのダーク×金は流用しない。
シンボルは**「畝と芽」に決定**(2026-08-04)。4 案から選定。畝(明るい緑)を最後に描いて
茎の根元を覆うことで「植わっている」ように見せている — 芽を宙に浮かせると
畑ではなく観葉植物に見えるため。

**マークの正は `apps/mobile/assets/brand/mark.svg`。** アイコン・スプラッシュ・favicon は
`pnpm assets:brand` で SVG から書き出す。**PNG を直接編集しないこと**(pre-commit で
`--check` が走り、SVG と食い違うと落ちる)。
4 案を `apps/mobile/src/constants/theme.ts` の `PALETTES` に持ち、`ACTIVE_PALETTE` の変更だけで入れ替わる
(実機比較は `EXPO_PUBLIC_PALETTE=naedoko` でビルド)。比較モックは `mockup/palette-compare.html`、配色・シンボル・画面構成の根拠は `docs/画面設計.md`。
UI 表記は「さいえん手帳」。

## 8. 実装フェーズ(詳細は docs/WBS.md)

| フェーズ    | 内容                                    | 期日目安   |
| ----------- | --------------------------------------- | ---------- |
| v0.1 Alpha  | fork・不要機能削除・栽培 CRUD・作業ログ | 2026-08-18 |
| v0.5 Beta   | 収穫(写真)・リマインダー・資材          | 2026-09-15 |
| v1.0(次)    | 栽培暦・次の作業・ストア公開            | 2026-10-13 |
| v1.5        | AI 診断/相談・freemium                  | 2026-11-10 |
| v1.6 春支度 | 作付け計画・去年の今ごろ・共有          | 2027-01-31 |

**注意:** WBS 3.1(栽培暦 30 作物のマスターデータ作成)は 2026-08-09 に完了(判断②)。次の律速は 3.5〜3.9(ホーム統合・AdMob 実 ID・ストア公開)と T1/T2(テスト整備)。

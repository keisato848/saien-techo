# さいえん手帳 — CLAUDE.md

> Claude Code が毎回読むプロジェクト憲法。実装前に必ずこのファイル全体を読むこと。

---

## 1. プロダクト概要

**アプリ名:** さいえん手帳
**コンセプト:** 育てて、記録して、ちゃんと採れる。家庭菜園の手帳とアドバイス
**3 本柱:** 記録(作業ログ・写真) / 収穫(写真アルバム) / アドバイス(栽培暦・次の作業・AI 相談)
**プラットフォーム:** Android 先行 / iOS(React Native + Expo)
**ステージ:** **v0.1 Alpha の機能は一通り完了**(WBS 1.1〜1.9 / 2026-08-04)。
栽培 CRUD・場所管理・検索・作業ログ・ホームのタイムラインが動く。次は v0.5 Beta(WBS 2.x)。

だいどこ(C:\Projects\daidoko)のコードベースを移植して開発している。コンセプトは「私設・非 SNS・ローカルファースト」。

**だいどこ由来のコードがまだ同居している。** タブからは外してあるが、レシピ・買い物・在庫・調理記録の
画面とサービスは残っている(`app/(tabs)/recipes/`・`pantry.tsx`・`shopping.tsx`・`cooking-log.service.ts` ほか)。
これらは暗色テーマのままで、さいえん手帳の仕様とは無関係。読むときは対象外として扱うこと。
削除は v0.5 で行う(WBS 2.x の派生先が確定してから)。

## 2. ドキュメントインデックス(実装前に必ず参照)

| ファイル                       | 内容                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `docs/要件定義.md`             | 決定事項ログ・機能要件(R01〜R33)・収益化・フェーズ         |
| `docs/WBS.md`                  | 作業分解構成・マイルストーン・依存関係                     |
| `docs/ペルソナ・競合分析.md`   | ペルソナ 3 人・利用成立の因果仮説・競合体験マッピング      |
| `docs/インフラ・NW構成設計.md` | サーバー構成・コスト試算・決定事項 D1〜D5(承認済み)        |
| `docs/利用規約.md`             | 利用規約(サービス継続を保証しない旨・栽培アドバイスの免責) |
| `docs/画面設計.md`             | 配色(若葉)・タイポグラフィ・v0.1 の 3 画面の設計           |
| `docs/データ設計.md`           | ER・テーブル定義・移行方針(だいどこと併存)                 |
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
- OCR ネイティブモジュール(`plugins/withSaienOcr.js`・`com.saientecho.app.ocr`)と DB ファイル名(`saien-techo.db`)は WBS 1.5 で差し替え済み
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

| フェーズ       | 内容                                    | 期日目安   |
| -------------- | --------------------------------------- | ---------- |
| v0.1 Alpha(次) | fork・不要機能削除・栽培 CRUD・作業ログ | 2026-08-18 |
| v0.5 Beta      | 収穫(写真)・リマインダー・資材          | 2026-09-15 |
| v1.0           | 栽培暦・次の作業・ストア公開            | 2026-10-13 |
| v1.5           | AI 診断/相談・freemium                  | 2026-11-10 |
| v1.6 春支度    | 作付け計画・去年の今ごろ・共有          | 2027-01-31 |

**注意:** WBS 3.1(栽培暦 30 作物のマスターデータ作成)は最重量タスク。v0.5 期間中から前倒しで並行着手すること。

# さいえん手帳

育てて、記録して、ちゃんと採れる。家庭菜園の手帳とアドバイス。

**3 本柱:** 記録(作業ログ・写真) / 収穫(写真アルバム) / アドバイス(栽培暦・次の作業・AI 相談)

React Native + Expo(SDK 54) / Expo Router v6 / expo-sqlite + Drizzle ORM。
だいどこ(料理アプリ)のコードベースを fork して開発している。

## リポジトリ構成

| パス              | 内容                                                          |
| ----------------- | ------------------------------------------------------------- |
| `apps/mobile`     | アプリ本体(Android / iOS)。**このリポジトリの中身はほぼこれ** |
| `packages/shared` | アプリとサーバーで共有する型・スキーマ                        |
| `scripts/`        | ビルド・リリース・エージェントハーネスのスクリプト            |
| `docs/`           | 要件定義・WBS・設計書                                         |

## AI 推論サーバーはこのリポジトリに無い

**サーバーコードの正は だいどこ側の `C:\Projects\daidoko/apps/server`。**
さいえん手帳は AI 推論(`/api/v1/garden/consult` `/garden/harvest` `/garden/identify`)を
**だいどこの Railway インスタンスと共用**している(WBS 決定⑨ — 固定費を増やさないため)。
接続先は `apps/mobile/src/config.ts` の `SERVER_BASE_URL`。

かつてこのリポジトリにも `apps/server` があったが、**どこにもデプロイされておらず**、
中身はだいどこ由来(レシピ推論・食材の名寄せ・既定 200 のレート制限)のまま、
実際に効いている値と食い違っていた。**嘘の参照元**になるため WBS T6(#150)で削除した。
併せて、そこだけを対象にしていた `railway.json` / `infra`(AWS CDK)/
`.github/workflows/vision-poc.yml` / `deploy-server` skill も削除している。

- サーバー側の日次上限(コストの天井)を調べる・変えるときは、だいどこの
  `apps/server/src/lib/rate-limit.ts` を見ること。このリポジトリには無い
- 現行の天井と単価は `docs/インフラ・NW構成設計.md` §5-1〜§5-4
- 将来さいえん手帳を独立させる場合は、決定 D1/D3(AWS Lambda + SAM)に沿って
  **新規に**書き起こす。削除したコードを掘り返す価値は無い(レシピ推論用だったため)

## ドキュメント

| ファイル                       | 内容                                               |
| ------------------------------ | -------------------------------------------------- |
| `CLAUDE.md`                    | プロジェクト憲法(実装前に必ず読む)                 |
| `docs/要件定義.md`             | 決定事項ログ・機能要件(R01〜R33)・収益化・フェーズ |
| `docs/WBS.md`                  | 作業分解構成・マイルストーン・依存関係             |
| `docs/インフラ・NW構成設計.md` | サーバー構成・コスト試算・決定事項 D1〜D5          |
| `docs/データ設計.md`           | ER・テーブル定義                                   |
| `docs/画面設計.md`             | 配色(若葉)・タイポグラフィ・画面設計               |
| `docs/リリース手順.md`         | 署名鍵・掲載 CLI・AAB 提出                         |
| `docs/開発ハーネス.md`         | Skill・エージェント・フック・実機検証規約          |

## 開発

```bash
pnpm install
pnpm dev:mobile          # Expo 開発サーバー
pnpm typecheck && pnpm lint && pnpm test
```

## 計画

- 進捗管理: GitHub Projects「さいえん手帳 開発計画」+ 本リポジトリの Issues/Milestones
- フェーズ: v0.1 Alpha → v0.5 Beta → v1.0(ストア公開) → v1.5(AI・統計) → v1.6 春支度 → v2.0

## ステータス

**1.3.0 を Google Play・App Store に提出済み**(2026-09-03)。
最新の状況は `CLAUDE.md` §1 を正とする。

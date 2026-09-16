---
target: gemini-store-analytics
title: Gemini レビュー（ストア指標の機械化・PR #196 / #197）
date: 2026-09-17
reviewer: Gemini（gemini-3.1-pro-high・Antigravity CLI）
---

## 背景

PR #196（ストア指標の機械化）と #197（ペルソナ資料の追随）に対して、
`gh pr create` 直前のフック（`pretool-pr-review.mjs`）が自動で回した敵対的レビュー。
材料は `.scratch/reviews/2026-09-16T12-19-19-430Z-pr-create.md` と
`2026-09-16T12-23-09-500Z-pr-create.md`（統合リポジトリ側・ignore）。

**このうち `should` / `nit` の 2 件は会話に出てこなかった。** フックが止めるのは
`block` だけで、それ以外は成果物に書かれるだけだったため、PR はそのままマージされた。
節目の `harness:gemini-review` を回した際に artifact を読み返して気づいた。

> **`harness:gemini-review --base main` は saien-techo を見られない。**
> `plugin/scripts/gemini-review.mjs` は材料の収集先を `HARNESS_ROOT` に固定しており、
> どのリポジトリで叩いても統合リポジトリの差分をレビューする。このリポジトリの差分に
> 別 LLM の目を通せるのは `gh pr create` 直前のフックだけ。

## 指摘

### 1. Play の `reviews.list` は「レビュー 0 件」の根拠にならない

- **状態**: done
- **重大度**: 高
- **指摘**: Play Developer API の `reviews.list` は直近 1 週間程度のレビューしか返さない仕様のため、リリース（8/23）から 3 週間以上経過した 9/16 に API で 0 件であっても、累計 0 とは限らない。利用者の反応を過小評価する恐れがある。
- **調査**: 公式手順書「Reply to Reviews API」で裏取りしたところ**当たり**だった。制限は 2 つある。「You can retrieve only the reviews that users have created or modified within the last week.」「If a user rates your app but does not provide a comment, their feedback is not accessible from the API.」つまり期間だけでなく、**コメントの無い星だけの評価は API から一切見えない**。累計は Play Console の CSV でしか分からない。
- **判断**: 採用。`store-status.mjs` の出力文言が「0 件（利用者が少ない可能性）」で累計 0 と読めてしまうため、集計の範囲そのものを出力に書く。
- **対応**: PR #196 と #197（`store-status.mjs` の出力・`docs/リリース手順.md` §6b・`docs/ペルソナ・競合分析.md` §6.3）

### 2. App Store Connect API も星のみの評価を返さない

- **状態**: done
- **重大度**: 中
- **指摘**: `customerReviews` も「テキストコメントのない星のみの評価」を含まない。API が 0 件でも「累計 0 と読んでよい」と判断すると、存在するかもしれない星のみの評価を見落とす。
- **調査**: **推論としては当たり。** #1 を直すときに「ASC の `customerReviews` は全期間を返すので累計 0 と読んでよい」と書いたが、これは期間の話しかしておらず、星のみの評価を拾えるかには答えていない。Apple の該当ドキュメントは JS 描画で WebFetch では読めなかったため、仕様の明文は取れていない。
  代わりに**公開の iTunes Lookup API で実測した**（`https://itunes.apple.com/lookup?id=6801141151&country=jp`）。結果は `userRatingCount: 0` / `averageUserRating: 0` / 現行版も 0。
  **結論（App Store の累計評価は 0）は偶然にも正しかったが、根拠として書いた理由が間違っていた。**
- **判断**: 採用。結論は変わらないが、根拠を「API が全期間を返すから」ではなく「公開 Lookup の `userRatingCount` が 0 だから」に差し替える。こちらは星のみの評価も含む総数なので、この用途では決定的。
- **対応**: 本 PR（`docs/ペルソナ・競合分析.md` §6.3）

### 3. 「全期間を返す」という表現がページネーションの取りこぼしを招く

- **状態**: done
- **重大度**: 低
- **指摘**: 将来レビュー数が増えて自動化する際、「1 回の API 呼び出しで全期間分が返る」と誤認してページネーション（`links.next`）の実装を忘れ、取得上限を超えた古いレビューを取りこぼす恐れがある。
- **調査**: 当たり。`store-status.mjs` の ASC 側は `?limit=5` で呼んでおり、そもそも 5 件しか見ていない。現状 0 件なので実害は無いが、文書の表現が将来の実装者を誤らせる。
- **判断**: 採用。#2 の書き換えで「全期間を返す」という表現自体を消す。
- **対応**: 本 PR

### 4. 統合リポジトリを review モードに一律固定するのは過剰な一般化

- **状態**: wontfix
- **重大度**: 低
- **指摘**: 保護領域をパスで機械判定する仕組みがあるのに、統合リポジトリだからという理由で全体を `review` に固定するのは過剰。全環境で `write` を基本とし、パス判定に一本化すべき。
- **調査**: **この指摘は統合リポジトリ（`C:\Projects\claude-harness`）の設計に対するもので、さいえん手帳の差分とは無関係。** 節目レビューを回したところ、スクリプトの仕様により統合リポジトリの差分がレビューされたため混入した。
- **判断**: このリポジトリでは対応しない。統合リポジトリ側のセッションへ共有済み。
- **対応**: なし（`docs/reviews/gemini-review-2026-09-17.md` は統合リポジトリ側にある）

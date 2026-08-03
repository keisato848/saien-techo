---
name: review-log
description: レビュー指摘をリポジトリ内に統一形式で記録・追跡する。PR レビュー、ハーネス監査、コードレビュー、設計レビューのいずれも docs/レビュー記録/ に 1 レビュー 1 ファイルで残し、各指摘の判断（対応する/見送る）と根拠を必ず添える。レビューを受けたとき、指摘に対応したとき、未対応の指摘を確認したいときに使用する。
allowed-tools: Bash(node scripts/agent/review-log.mjs*)
---

# レビュー記録

レビュー指摘は**会話に流すと消える**。判断（特に「見送る」判断）とその根拠がリポジトリに残らないと、同じ議論を繰り返す。

## 置き場所

```
docs/レビュー記録/
  README.md              # 索引（未対応件数つき）。手で書かず review-log.mjs が再生成する
  2026-08-03-pr54.md     # 1 レビュー 1 ファイル
```

命名は `YYYY-MM-DD-<対象>.md`。対象は `pr54` / `harness-audit` / `infra-design` のように短く。

## 使い方

```bash
node scripts/agent/review-log.mjs new --target pr54 --title "PR #54 レビュー"  # 雛形作成
node scripts/agent/review-log.mjs import-pr 54                                  # GitHub の PR レビューを取り込む
node scripts/agent/review-log.mjs index                                         # README.md を再生成
node scripts/agent/review-log.mjs open                                          # 未対応の指摘だけ一覧
node scripts/agent/review-log.mjs check                                         # 書式検証（pre-commit から実行）
```

## 記録するタイミング

| いつ                 | 何を                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| レビューを受けた直後 | 指摘を全件書き出す。この時点では「判断」欄は空でよい                  |
| 判断が決まったとき   | 対応する / 見送る を理由つきで埋める                                  |
| 対応したとき         | 対応欄にコミット SHA か PR 番号を書き、状態を `done` にする           |
| レビューを実施した側 | 自分が出した指摘も同じ形式で残す（harness-reviewer の監査レポート等） |

## 書式

各ファイルは frontmatter + 指摘表。frontmatter は索引生成に使うため必須。

```markdown
---
target: pr54
title: PR #54 レビュー
date: 2026-08-03
reviewer: ユーザー
---

## 背景

<何をレビューしたか。対象の範囲を 1〜2 文で>

## 指摘

### 1. <指摘の要約>

- **状態**: open | done | wontfix
- **重大度**: 高 | 中 | 低
- **指摘**: <レビュー者の指摘をそのまま>
- **調査**: <裏を取った結果。推測と事実を分けて書く>
- **判断**: <対応する / 見送る。理由を必ず書く>
- **対応**: <コミット SHA / PR 番号 / 「なし」>
```

**`状態` と `判断` は必ず埋める。** 「見送る」も立派な判断で、理由が残っていれば次に同じ指摘が来たときに即答できる。

## Gotchas

- **「対応した」と書く前に、実際に動くことを確かめる。** このリポジトリでは、検証コードのバグで「0 件 = 成功」を誤報しかけた実績が 2 回ある（CRLF による frontmatter 取りこぼし、Hermes バイトコードへの grep）。正の対照を置いて、検出できるはずのものが検出されることを先に確認する
- **レビュー者の指摘をそのまま鵜呑みにしない。** 実物を確認してから判断を書く。実際、ハーネス監査の指摘 1 件は既に修正済みの内容を古い状態のまま指摘していた（CLAUDE.md §1）
- **判断が「見送る」でもファイルからは消さない。** 消すと理由ごと失われる。`状態: wontfix` にして残す
- 索引 `README.md` は `review-log.mjs index` が再生成する。手で編集しても次回上書きされる
- GitHub の PR レビューコメントは `import-pr` で取り込めるが、**会話で受けた指摘は自動では入らない**。手で書く

## 検証ループ

1. 記録を書く
2. `node scripts/agent/review-log.mjs check` で書式を検証する
3. `node scripts/agent/review-log.mjs index` で索引を再生成する
4. 未対応が残っていれば `open` で確認し、次の作業に引き継ぐ

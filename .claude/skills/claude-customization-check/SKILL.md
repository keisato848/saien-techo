---
name: claude-customization-check
description: .claude 配下のスキル・サブエージェント・フック配線を Claude Code の公式仕様に対して機械検証する。未定義の frontmatter フィールド、不正な model/effort/permissionMode 値、description の 1,536 文字超過、死蔵アセット、実在しないフックスクリプトを検出する。ハーネスを編集した後、他リポジトリからスキルを移植した後、または harness-auditor で採点する前に使用する。
allowed-tools: Bash(node scripts/agent/validate-claude-customizations.mjs*)
---

# Claude カスタマイズ検証

`.claude/` が Claude Code の仕様どおりかを機械的に確認する。**採点（`harness-auditor`）より先にこれを通す。**

## 実行

```bash
node scripts/agent/validate-claude-customizations.mjs           # 通常
node scripts/agent/validate-claude-customizations.mjs --json    # JSON 出力（フック連携用）
node scripts/agent/validate-claude-customizations.mjs --strict   # WARN もエラー終了扱い
```

ERROR が 1 件でもあれば終了コード 1。ERROR はすべて「書いた設定が黙って無視されている」類のもので、動作に直接効く。

## 検出する内容

| 対象                  | ルール                                                                                                  | 重大度 |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| スキル / エージェント | 公式仕様にない frontmatter フィールド                                                                   | ERROR  |
| 両方                  | `model` / `effort` / `permissionMode` / `memory` / `color` / `isolation` / `context` / `shell` の不正値 | ERROR  |
| スキル                | `description` + `when_to_use` が 1,536 文字超過                                                         | ERROR  |
| スキル                | `SKILL.md` がない / frontmatter が壊れている                                                            | ERROR  |
| エージェント          | `name` 欠落・不正（小文字とハイフン以外）・重複                                                         | ERROR  |
| エージェント          | `description` 欠落                                                                                      | ERROR  |
| エージェント          | 読み取り専用を宣言しているのに `tools` に Edit/Write がある                                             | ERROR  |
| フック                | `settings.json` が参照するスクリプトが実在しない                                                        | ERROR  |
| スキル                | `name` がディレクトリ名と不一致                                                                         | WARN   |
| スキル                | 500 行超過                                                                                              | WARN   |
| スキル                | `assets/` 等が存在するのに本文から未参照（死蔵アセット）                                                | WARN   |
| スキル                | `description` の書き出しが他スキルと重複                                                                | WARN   |
| スキル                | `agent` / `background` を `context: fork` なしで指定                                                    | WARN   |
| エージェント          | `.agent.md` 拡張子（Copilot 命名）                                                                      | WARN   |
| エージェント          | `tools` 未指定（全ツール継承）                                                                          | WARN   |

## 仕様の出典

- Agent Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents

**仕様が変わったらスクリプト側の定数（`SKILL_FIELDS` / `AGENT_FIELDS` / 各 enum）を更新する。** スクリプトは公式ドキュメントの写しであり、それ自体が真実ではない。

## Gotchas

- **`.github/skills` と `.github/agents` は検証対象外**。Claude Code が読むのは `.claude/` だけで、`.github/` 側は GitHub Copilot 用。本リポジトリは両方持っているため、直したつもりが別系統だった、という取り違えが起きやすい
- 他リポジトリから移植したスキルは **`metadata:` や `handoffs:` を持っていることが多い**。どちらも Claude Code には存在せず黙って無視されるため、移植直後は必ずこれを通す
- **description は「人が読んで分かるか」ではなくルーティング精度で書く。** 1,536 文字はスキル一覧での切り捨て境界であり、超えた分は起動判断に使われない
- frontmatter パーサは依存を増やさないための最小実装。`key: value` / ブロックリスト / 折り畳みスカラのみ対応し、ネストしたマップ（`hooks` `mcpServers`）は値まで検証しない。複雑な YAML を書いた場合は誤検知しうる
- 検証が 0 件で通ったときは、**本当に走査できているかを疑う**。スキルを 1 つ意図的に壊して ERROR が出ることを確認するのが確実

## 検証ループ

1. スクリプトを実行する
2. ERROR をすべて解消する
3. WARN は理由を添えて残すか解消するかを判断する（死蔵アセットは削除か参照追加のどちらか）
4. 再実行して ERROR 0 を確認する
5. 変更が振る舞いを変える場合は `docs/開発ハーネス.md` を更新する

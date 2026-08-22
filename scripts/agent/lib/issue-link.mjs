/**
 * PR と Issue の紐付け検査（PreToolUse ガードと PostToolUse 検証で共有）。
 *
 * ## なぜ必要か
 *
 * CLAUDE.md §3 に「完了時に Issue をクローズする」と書いてあったが、
 * 2026-08-11〜12 の作業で **5 本の PR をマージして 1 件も閉じなかった**
 * （#25/#26/#27/#28 が完了済みのまま open・#27/#28 はマイルストーンも v1.5 のまま）。
 * 散文の規約は守られないので、機械で止める。
 *
 * ## 設計
 *
 * 「マージ後に閉じ忘れを督促する」のではなく、**PR 作成時に紐付けの宣言を強制する**。
 * 本文に `Closes #N` があれば GitHub がマージ時に自動で閉じるので、
 * 「閉じる」という作業自体が消える（規律に頼らない）。
 */

/** 本文/タイトルから WBS 番号を拾う。例: "WBS 3.10" "(WBS 3.7 / 3.8)" "WBS T1" */
const WBS_IN_TITLE = /\bWBS\s*(T?\d+(?:\.\d+)*[a-z]?)/i;

/** GitHub がマージ時に自動クローズするキーワード（公式仕様） */
const CLOSING_KEYWORD = /\b(clos(e|es|ed)|fix(e[sd])?|resolv(e|es|ed))\s+#\d+/i;

/** 「この PR では閉じない」の明示。WBS 項目が複数 PR にまたがるときの逃げ道 */
const REFS_ONLY = /\bRefs?\s+#\d+/i;

/** Issue が無い作業（ハーネス調整・追従修正など）の明示的な opt-out */
const NO_ISSUE = /(^|\n)\s*(Issue|課題)\s*[:：]\s*(なし|無し|none)/i;

/**
 * PR 作成コマンドを検査する。
 *
 * @param {string} commandText 実行しようとしているシェルコマンド全文
 * @returns {{ ok: true } | { ok: false, wbs: string, reason: string }}
 */
export function inspectPrCreate(commandText) {
  if (!/\bgh\s+pr\s+create\b/i.test(commandText)) return { ok: true };

  const title = extractFlag(commandText, 'title') ?? '';
  const body = extractBody(commandText) ?? '';
  const haystack = `${title}\n${body}`;

  const wbsMatch = WBS_IN_TITLE.exec(title);
  if (!wbsMatch) return { ok: true }; // WBS 番号の無い PR は対象外

  if (CLOSING_KEYWORD.test(body) || REFS_ONLY.test(body) || NO_ISSUE.test(haystack)) {
    return { ok: true };
  }

  return {
    ok: false,
    wbs: wbsMatch[1],
    reason:
      `WBS ${wbsMatch[1]} の PR ですが、本文に Issue の紐付けがありません。\n` +
      `**Issue を閉じ忘れる事故が実際に起きています**（2026-08-12: 完了済み 4 件が open のまま・` +
      `マイルストーンも v1.5 のまま残っていた）。\n\n` +
      `本文に次のいずれかを入れてから再実行してください:\n` +
      `  - \`Closes #<番号>\`  … マージ時に GitHub が自動で閉じる（推奨）\n` +
      `  - \`Refs #<番号>\`    … この PR では閉じない（WBS 項目が複数 PR にまたがる場合）\n` +
      `  - \`Issue: なし（理由）\` … 対応する Issue が無い場合\n\n` +
      `番号が分からなければ \`gh issue list --search "WBS ${wbsMatch[1]}"\` で探せます。`,
  };
}

/**
 * `--title` の値を取り出す。引用符の対応を見る（タイトルは 1 行で短い）。
 */
function extractFlag(commandText, flag) {
  const pattern = new RegExp(`--${flag}\\s+(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`, 's');
  const match = pattern.exec(commandText);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * `--body` 以降をまるごと本文として扱う。
 *
 * **引用符の対応を見る `extractFlag` を本文に使ってはいけない。** 本文は
 * ヒアドキュメント（`--body "$(cat <<'EOF' … EOF)"`）で渡すのが常で、
 * その中には **ASCII の `"` が普通に出てくる**（`behavior="padding"` のような
 * コード片）。すると `[^"]*` が最初の `"` で止まり、末尾に書いた `Closes #N` まで
 * 読めずに**正しい PR を誤って弾く**（2026-08-17 に実際に踏んだ）。
 *
 * 誤ブロックは「守られない規約」より質が悪い — 通すために本文の日本語を
 * 書き換える羽目になり、ガードを迂回する動機を作る。`--body` は
 * `gh pr create` で最後に置くのが通例なので、**以降を全部**見れば足りる。
 * 後ろに別のフラグが続いても、キーワード検索なので害はない。
 */
function extractBody(commandText) {
  const match = /--body\s+/.exec(commandText);
  if (!match) return null; // --body-file はここでは読めない。従来どおり deny になる
  let body = commandText.slice(match.index + match[0].length);

  // `Issue: なし` の判定は行頭アンカー。開きの引用符とヒアドキュメントの
  // 前置き（`$(cat <<'EOF'`）が残ると 1 行目が行頭でなくなるので剥がす。
  body = body.replace(/^["']/, '');
  if (body.startsWith('$(')) body = body.replace(/^[^\n]*\n/, '');
  return body;
}

/** PR 番号を `gh pr merge <N>` から取り出す（PostToolUse 検証用） */
export function extractMergedPrNumber(commandText) {
  if (!/\bgh\s+pr\s+merge\b/i.test(commandText)) return null;
  const match = /\bgh\s+pr\s+merge\s+(\d+)/i.exec(commandText);
  return match ? match[1] : null;
}

/**
 * PR 本文から Issue 参照を抽出する。
 * `closes` は GitHub が自動クローズするもの、`refs` は参照だけのもの。
 * フック本体に埋めるとテストできないのでここに置く。
 *
 * @param {string} body
 * @returns {{ closes: string[], refs: string[] }}
 */
export function parseIssueRefs(body) {
  const text = body ?? '';
  const closes = [
    ...text.matchAll(/\b(?:clos(?:e|es|ed)|fix(?:e[sd])?|resolv(?:e|es|ed))\s+#(\d+)/gi),
  ].map((m) => m[1]);
  const refs = [...text.matchAll(/\bRefs?\s+#(\d+)/gi)].map((m) => m[1]);
  return { closes: [...new Set(closes)], refs: [...new Set(refs)] };
}

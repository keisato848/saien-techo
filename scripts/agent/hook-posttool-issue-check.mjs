/**
 * PostToolUse フック: `gh pr merge` の直後に、その PR が閉じるはずだった Issue が
 * 本当に閉じたかを実測で確認する（PreToolUse の宣言強制に対する保険）。
 *
 * ## なぜ保険が要るか
 *
 * PreToolUse は `gh pr create` の本文に `Closes #N` を書かせるところまでしかできない。
 * 次の穴が残る:
 *   - `Refs #N`（複数 PR にまたがる場合の逃げ道）を使った最後の PR で閉じ忘れる
 *   - Web UI や別セッションで作られた PR をこのセッションでマージする
 *   - 番号違いを書いていて別の Issue が閉じる
 *
 * ここは **ブロックしない**（マージは既に完了しているので止めても意味がない）。
 * 事実だけを文脈として返し、次の一手をわたしに促す。
 *
 * 失敗しても黙って allow する — ネットワークが無い/gh 未認証で作業が止まる方が害が大きい。
 */
import { readStdinJson, runCommand } from './lib/runtime.mjs';
import { extractMergedPrNumber, parseIssueRefs } from './lib/issue-link.mjs';

const payload = await readStdinJson();
const commandText = extractCommandText(payload);
const prNumber = commandText ? extractMergedPrNumber(commandText) : null;

if (!prNumber) {
  emit(null);
} else {
  emit(await checkClosedIssues(prNumber));
}

/**
 * PR 本文から参照 Issue 番号を拾い、それぞれの open/closed を確認する。
 * `Closes #N` と `Refs #N` を区別し、**Closes なのに open のまま**だけを問題にする。
 */
async function checkClosedIssues(prNumber) {
  const pr = ghJson(['pr', 'view', prNumber, '--json', 'body,title']);
  if (!pr) return null;

  const { closes, refs } = parseIssueRefs(pr.body);

  const stillOpen = [];
  for (const number of closes) {
    const issue = ghJson(['issue', 'view', number, '--json', 'state,title']);
    if (issue?.state === 'OPEN') stillOpen.push(`#${number} ${issue.title}`);
  }

  if (stillOpen.length > 0) {
    return (
      `⚠ PR #${prNumber} をマージしましたが、Closes 指定した Issue が閉じていません:\n` +
      stillOpen.map((s) => `  - ${s}`).join('\n') +
      `\n（base ブランチが default でない場合、GitHub は自動クローズしません。手で閉じてください）`
    );
  }

  if (refs.length > 0) {
    return (
      `PR #${prNumber} は Refs 指定（この PR では閉じない）で ${refs.map((n) => `#${n}`).join(' ')} を参照しています。\n` +
      `WBS 項目が完了したなら、対応する Issue を閉じてマイルストーンも確認してください。`
    );
  }

  if (closes.length > 0) {
    return `PR #${prNumber} のマージで ${closes.map((n) => `#${n}`).join(' ')} が閉じました。`;
  }
  return null;
}

function ghJson(args) {
  try {
    const result = runCommand('gh', args, { timeout: 15_000 });
    if (result.status !== 0 || !result.stdout) return null;
    return JSON.parse(result.stdout);
  } catch {
    return null; // ネットワーク断・未認証・タイムアウトでは黙って諦める
  }
}

function extractCommandText(input) {
  const toolInput = input?.tool_input ?? input?.toolInput ?? {};
  return typeof toolInput.command === 'string' ? toolInput.command : '';
}

function emit(additionalContext) {
  if (!additionalContext) {
    process.stdout.write('{}\n');
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }, null, 2)}\n`,
  );
}

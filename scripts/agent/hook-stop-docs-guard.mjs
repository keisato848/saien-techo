/**
 * Stop フック: ターン終了時に「ドキュメント連動ファイルが変更されているのに
 * 対応ドキュメント / Skill が未更新」なら一度だけ停止をブロックし、
 * 更新（または不要理由の明示）を自律実行させる。
 *
 * - ループ防止: stop_hook_active が立っていたら必ず allow
 * - 対象: 作業ツリーの変更 + （feature ブランチなら）develop からの差分
 * - 対応表: lib/docs-map.mjs（PostToolUse リマインダーと共有）
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson, runCommand, unique } from './lib/runtime.mjs';
import { DOC_TARGET_HINT, matchDocTargets } from './lib/docs-map.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const payload = await readStdinJson();

// 直前の Stop ブロックから続行してきた場合は再ブロックしない（無限ループ防止）
if (payload?.stop_hook_active) {
  allow();
}

const changed = collectChangedFiles();
if (changed.length === 0) {
  allow();
}

const { targets, hits } = matchDocTargets(changed);
if (targets.length === 0) {
  allow();
}

// ドキュメント側も同時に変更されていれば督促不要
const docTouched = changed.some((file) => DOC_TARGET_HINT.test(file));
if (docTouched) {
  allow();
}

const fileList = unique(hits.map((hit) => hit.file))
  .slice(0, 5)
  .join(', ');
process.stdout.write(
  `${JSON.stringify({
    decision: 'block',
    reason:
      `ドキュメント連動ファイル（${fileList}）が変更されていますが、対応するドキュメント/Skill が未更新です。` +
      `次を更新してください: ${targets.join(' / ')}。` +
      '振る舞い・手順が変わらない変更で更新不要な場合は、その理由をユーザーへの報告に含めたうえで終了してください。',
  })}\n`,
);
process.exit(0);

function collectChangedFiles() {
  const files = [];

  // 作業ツリー（staged + unstaged + untracked）
  // -z はレコード区切りが NUL で、パスがクオート/エスケープされない。既定形式では
  // 非 ASCII 名が "docs/\343\202\244..." となり、日本語 docs を取りこぼしていた。
  // R/C（リネーム・コピー）だけは「XY 新パス\0旧パス\0」と 2 レコードになる。
  const status = runCommand('git', ['status', '--porcelain', '-z'], { cwd: rootDir });
  if (status.ok) {
    const records = status.stdout.split('\0').filter(Boolean);
    for (let i = 0; i < records.length; i += 1) {
      const code = records[i].slice(0, 2);
      const file = records[i].slice(3).trim();
      if (file) files.push(file.replace(/\\/g, '/'));
      if (code.includes('R') || code.includes('C')) i += 1; // 続く旧パスのレコードを読み飛ばす
    }
  }

  // feature ブランチなら develop からの差分も見る（コミット済みの未文書化を拾う）
  const branch = runCommand('git', ['branch', '--show-current'], { cwd: rootDir });
  const name = branch.ok ? branch.stdout.trim() : '';
  if (name && name !== 'develop' && name !== 'main') {
    const diff = runCommand('git', ['diff', '--name-only', '-z', 'develop...HEAD'], {
      cwd: rootDir,
    });
    if (diff.ok) {
      for (const line of diff.stdout.split('\0')) {
        const file = line.trim();
        if (file) files.push(file.replace(/\\/g, '/'));
      }
    }
  }

  return unique(files);
}

function allow() {
  process.stdout.write(`${JSON.stringify({})}\n`);
  process.exit(0);
}

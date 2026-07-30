/**
 * pre-commit: ステージ済みファイルを Prettier で自動整形して再ステージする。
 * 整形差分・CRLF 起因のコミット失敗ループ（1.3.0 リリース中に頻発）を根絶する。
 */
import { runCommand } from './lib/runtime.mjs';

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/i;

// -z は必須。既定(core.quotepath=true)では非 ASCII のパスが
// "docs/\343\202\244..." のようにエスケープされて返り、そのまま prettier に
// 渡すと --ignore-unknown が存在しないファイルとして黙って読み飛ばす。
// 日本語ファイル名の docs が整形されないまま CI の Format check で落ちていた。
const diff = runCommand('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
if (!diff.ok) {
  console.error('format-staged: git diff failed');
  process.exit(1);
}

const files = diff.stdout
  .split('\0')
  .map((line) => line.trim())
  .filter((line) => line && EXTENSIONS.test(line));

if (files.length === 0) {
  process.exit(0);
}

// Windows のコマンドライン長制限(約 8KB)を超えないようチャンクで実行する
function* chunks(list, size) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const batch of chunks(files, 40)) {
  const prettier = runCommand(pnpmCmd, [
    'exec',
    'prettier',
    '--write',
    '--ignore-unknown',
    ...batch,
  ]);
  if (!prettier.ok) {
    console.error('format-staged: prettier failed');
    console.error(prettier.combinedOutput?.slice(0, 1000) ?? '');
    process.exit(1);
  }
}

for (const batch of chunks(files, 40)) {
  const add = runCommand('git', ['add', '--', ...batch]);
  if (!add.ok) {
    console.error('format-staged: git add failed');
    process.exit(1);
  }
}

console.log(`[OK] prettier auto-format: ${files.length} file(s)`);

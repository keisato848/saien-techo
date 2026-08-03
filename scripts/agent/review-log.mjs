/**
 * レビュー記録（docs/レビュー記録/）の作成・取り込み・索引生成・検証。
 *
 * レビュー指摘を会話に流すと、判断（特に「見送る」判断）とその根拠が残らず、
 * 同じ議論を繰り返す。1 レビュー 1 ファイルでリポジトリ内に残し、未対応の
 * 指摘を機械的に数えられるようにする。
 *
 * 使い方:
 *   node scripts/agent/review-log.mjs new --target pr54 --title "PR #54 レビュー"
 *   node scripts/agent/review-log.mjs import-pr 54
 *   node scripts/agent/review-log.mjs index
 *   node scripts/agent/review-log.mjs open
 *   node scripts/agent/review-log.mjs check
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommand } from './lib/runtime.mjs';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const recordsDir = join(rootDir, 'docs', 'レビュー記録');
const INDEX_FILE = 'README.md';

const STATES = ['open', 'done', 'wontfix'];
const SEVERITIES = ['高', '中', '低'];

// --- 共通 -------------------------------------------------------------------

function ensureDir() {
  if (!existsSync(recordsDir)) mkdirSync(recordsDir, { recursive: true });
}

function recordFiles() {
  ensureDir();
  return readdirSync(recordsDir)
    .filter((name) => name.endsWith('.md') && name !== INDEX_FILE)
    .sort();
}

/** frontmatter を読む。CRLF は先に潰す（`.` が `\r` を行終端として扱うため）。 */
function parseRecord(name) {
  const raw = readFileSync(join(recordsDir, name), 'utf8').replace(/\r\n/g, '\n');
  const meta = {};
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) {
      for (const line of raw.slice(raw.indexOf('\n') + 1, end).split('\n')) {
        const m = /^([a-z_]+):\s*(.*)$/.exec(line);
        if (m) meta[m[1]] = m[2].trim();
      }
    }
  }

  // 指摘ブロック: 「### N. 見出し」ごとに 状態 / 重大度 を拾う
  const findings = [];
  const sections = raw.split(/\n### /).slice(1);
  for (const section of sections) {
    const title = section.split('\n')[0].trim();
    const state = /- \*\*状態\*\*:\s*(\S+)/.exec(section)?.[1] ?? '';
    const severity = /- \*\*重大度\*\*:\s*(\S+)/.exec(section)?.[1] ?? '';
    const decision = /- \*\*判断\*\*:\s*(.*)/.exec(section)?.[1]?.trim() ?? '';
    findings.push({ title, state, severity, decision });
  }
  return { name, meta, findings, raw };
}

// --- new --------------------------------------------------------------------

function cmdNew(args) {
  const target = argValue(args, '--target');
  const title = argValue(args, '--title') ?? target;
  if (!target) fail('--target は必須です（例: --target pr54）');

  const date = argValue(args, '--date') ?? isoDate();
  const file = `${date}-${target}.md`;
  const path = join(recordsDir, file);
  if (existsSync(path)) fail(`${file} は既に存在します`);

  ensureDir();
  writeFileSync(
    path,
    `---
target: ${target}
title: ${title}
date: ${date}
reviewer:
---

## 背景

<何をレビューしたか。対象の範囲を 1〜2 文で>

## 指摘

### 1. <指摘の要約>

- **状態**: open
- **重大度**: 中
- **指摘**: <レビュー者の指摘をそのまま>
- **調査**: <裏を取った結果。推測と事実を分けて書く>
- **判断**: <対応する / 見送る。理由を必ず書く>
- **対応**: なし
`,
    'utf8',
  );
  console.log(`作成: docs/レビュー記録/${file}`);
}

// --- import-pr --------------------------------------------------------------

function cmdImportPr(args) {
  const number = args.find((a) => /^\d+$/.test(a));
  if (!number) fail('PR 番号を指定してください（例: import-pr 54）');

  const res = runCommand('gh', ['pr', 'view', number, '--json', 'title,reviews,comments']);
  if (!res.ok) fail(`gh pr view に失敗しました:\n${res.combinedOutput.slice(0, 400)}`);

  const data = JSON.parse(res.stdout);
  const entries = [
    ...(data.reviews ?? []).map((r) => ({ who: r.author?.login, body: r.body })),
    ...(data.comments ?? []).map((c) => ({ who: c.author?.login, body: c.body })),
  ].filter((e) => (e.body ?? '').trim() !== '');

  const date = isoDate();
  const file = `${date}-pr${number}.md`;
  const path = join(recordsDir, file);
  if (existsSync(path)) fail(`${file} は既に存在します。手で追記してください`);

  ensureDir();
  const sections = entries
    .map(
      (e, i) => `### ${i + 1}. <要約を書く>

- **状態**: open
- **重大度**: 中
- **指摘**: ${e.body.replace(/\n/g, '\n  ')}
- **調査**: <裏を取る>
- **判断**: <対応する / 見送る。理由を必ず書く>
- **対応**: なし
`,
    )
    .join('\n');

  writeFileSync(
    path,
    `---
target: pr${number}
title: ${data.title ?? `PR #${number}`}
date: ${date}
reviewer: ${entries[0]?.who ?? ''}
---

## 背景

PR #${number} のレビュー。

## 指摘

${sections || '（レビューコメントなし）'}`,
    'utf8',
  );
  console.log(`作成: docs/レビュー記録/${file}（${entries.length} 件取り込み）`);
}

// --- index ------------------------------------------------------------------

function cmdIndex() {
  const rows = [];
  for (const name of recordFiles()) {
    const { meta, findings } = parseRecord(name);
    const open = findings.filter((f) => f.state === 'open').length;
    rows.push({
      date: meta.date ?? '',
      title: meta.title ?? meta.target ?? name,
      file: name,
      total: findings.length,
      open,
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const totalOpen = rows.reduce((sum, r) => sum + r.open, 0);
  const body = `# レビュー記録

> このファイルは \`node scripts/agent/review-log.mjs index\` が生成する。手で編集しない。

指摘の記録方法は \`.claude/skills/review-log/SKILL.md\` を参照。

**未対応の指摘: ${totalOpen} 件**

| 日付 | レビュー | 指摘 | 未対応 |
| --- | --- | ---: | ---: |
${rows
  .map((r) => `| ${r.date} | [${r.title}](${encodeURI(r.file)}) | ${r.total} | ${r.open} |`)
  .join('\n')}
`;
  ensureDir();
  writeFileSync(join(recordsDir, INDEX_FILE), body, 'utf8');
  console.log(`索引を更新: ${rows.length} 件のレビュー、未対応 ${totalOpen} 件`);
}

// --- open -------------------------------------------------------------------

function cmdOpen() {
  let count = 0;
  for (const name of recordFiles()) {
    const { meta, findings } = parseRecord(name);
    const open = findings.filter((f) => f.state === 'open');
    if (open.length === 0) continue;
    console.log(`\n${meta.title ?? name}（${name}）`);
    for (const f of open) {
      console.log(`  [${f.severity || '?'}] ${f.title}`);
      count += 1;
    }
  }
  console.log(count === 0 ? '未対応の指摘はありません' : `\n未対応: ${count} 件`);
}

// --- check ------------------------------------------------------------------

function cmdCheck() {
  const problems = [];
  for (const name of recordFiles()) {
    const { meta, findings } = parseRecord(name);
    for (const key of ['target', 'title', 'date']) {
      if (!meta[key]) problems.push(`${name}: frontmatter に ${key} がない`);
    }
    if (findings.length === 0) problems.push(`${name}: 指摘が 1 件も書かれていない`);
    findings.forEach((f, i) => {
      const at = `${name} 指摘${i + 1}`;
      if (!STATES.includes(f.state)) {
        problems.push(`${at}: 状態が ${STATES.join(' / ')} のいずれでもない（"${f.state}"）`);
      }
      if (f.severity && !SEVERITIES.includes(f.severity)) {
        problems.push(`${at}: 重大度が ${SEVERITIES.join(' / ')} のいずれでもない`);
      }
      // 判断は「見送る」場合こそ理由が要る。空・雛形のままを落とす
      if (f.state !== 'open' && (f.decision === '' || f.decision.startsWith('<'))) {
        problems.push(`${at}: 状態が ${f.state} なのに判断が空（理由を書くこと）`);
      }
    });
  }

  for (const p of problems) console.log(`[NG] ${p}`);
  if (problems.length > 0) {
    console.log(`\nレビュー記録の検証: NG ${problems.length} 件`);
    process.exit(1);
  }
  console.log(`[OK] レビュー記録の検証: ${recordFiles().length} ファイル`);
}

// --- ユーティリティ ---------------------------------------------------------

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function isoDate() {
  // 実行日をローカル日付で。ハーネスの他スクリプトと揃える
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fail(message) {
  console.error(`review-log: ${message}`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'new':
    cmdNew(args);
    break;
  case 'import-pr':
    cmdImportPr(args);
    break;
  case 'index':
    cmdIndex();
    break;
  case 'open':
    cmdOpen();
    break;
  case 'check':
    cmdCheck();
    break;
  default:
    console.log('使い方: review-log.mjs <new|import-pr|index|open|check>');
    process.exit(command ? 1 : 0);
}

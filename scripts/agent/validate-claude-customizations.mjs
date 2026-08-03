/**
 * .claude/ 配下のカスタマイズ（スキル・サブエージェント・settings.json のフック）を
 * Claude Code の公式仕様に対して機械検証する。
 *
 * 仕様の出典:
 *   - Agent Skills:  https://code.claude.com/docs/en/skills
 *   - Subagents:     https://code.claude.com/docs/en/sub-agents
 *
 * harness-auditor の 7軸採点は「仕様には合っているが品質が低い」箇所を人手で見るもの。
 * こちらは「そもそも仕様に合っているか」を機械的に落とす。採点より先にこれを通すこと。
 *
 * 使い方:
 *   node scripts/agent/validate-claude-customizations.mjs            # 検証して結果を出力
 *   node scripts/agent/validate-claude-customizations.mjs --json     # JSON で出力
 *   node scripts/agent/validate-claude-customizations.mjs --strict   # WARN もエラー終了扱い
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const claudeDir = join(rootDir, '.claude');
const options = parseArgs(process.argv.slice(2));

// --- 仕様（公式ドキュメントの Supported frontmatter fields 由来） -------------

const SKILL_FIELDS = new Set([
  'name',
  'description',
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'allowed-tools',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'hooks',
  'paths',
  'shell',
]);

const AGENT_FIELDS = new Set([
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'permissionMode',
  'maxTurns',
  'skills',
  'mcpServers',
  'hooks',
  'memory',
  'background',
  'effort',
  'isolation',
  'color',
  'initialPrompt',
]);

const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
  'plan',
  'manual',
]);
const MEMORY_SCOPES = new Set(['user', 'project', 'local']);
const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);
const SHELLS = new Set(['bash', 'powershell']);

// description + when_to_use はスキル一覧で 1,536 文字に切り捨てられる
const MAX_LISTING_CHARS = 1536;
// SKILL.md はコンテキスト効率の観点で 500 行以内が推奨
const MAX_SKILL_LINES = 500;

const findings = [];

function add(severity, rule, file, message) {
  findings.push({ severity, rule, file, message });
}

// --- frontmatter パース ------------------------------------------------------

/**
 * 依存を増やさないための最小 YAML frontmatter パーサ。
 * 対応するのは `key: value` / ブロックリスト / 折り畳みスカラ(> |)のみ。
 * ネストしたマップ（hooks, mcpServers）は値を検証しないので存在確認だけ行う。
 */
function parseFrontmatter(raw) {
  // CRLF は先に潰す。JS の `.` は `\r` を行終端として扱うため、CRLF のままだと
  // frontmatter 最終行（閉じ `---` の直前）のキーが正規表現に一致せず、
  // フィールドが黙って欠落する。実際に取りこぼした実績あり。
  const normalized = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---')) return { ok: false, reason: 'frontmatter がない' };
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { ok: false, reason: 'frontmatter が閉じていない' };

  const body = normalized.slice(normalized.indexOf('\n', 3) + 1, end);
  const fields = {};
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    // トップレベルのキーのみ拾う（インデント行は直前のキーの続き）
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      // 折り畳み/リテラルスカラ: 後続のインデント行を連結
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].trim());
        i += 1;
      }
      value = parts.join(' ');
    } else if (value === '') {
      // ブロックリスト or ネストマップ
      const items = [];
      let nested = false;
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        const child = lines[i + 1].trim();
        if (child.startsWith('- ')) items.push(child.slice(2).trim());
        else nested = true;
        i += 1;
      }
      value = items.length > 0 ? items : nested ? { __nested: true } : '';
    }

    fields[key] = value;
  }

  return { ok: true, fields };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unquote(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^['"]|['"]$/g, '');
}

// --- 共通チェック ------------------------------------------------------------

function checkUnknownFields(fields, allowed, file, kind) {
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      add(
        'ERROR',
        'unknown-frontmatter-field',
        file,
        `${kind} に存在しないフィールド \`${key}\`。Claude Code は無視するため、意図した設定が効いていない`,
      );
    }
  }
}

function checkEnum(fields, key, allowed, file, { allowFullModelId = false } = {}) {
  if (!(key in fields)) return;
  const value = unquote(fields[key]);
  if (typeof value !== 'string' || value === '') return;
  if (allowed.has(value)) return;
  if (allowFullModelId && /^claude-[a-z0-9-]+$/.test(value)) return;
  add(
    'ERROR',
    `invalid-${key}`,
    file,
    `\`${key}: ${value}\` は許可されていない値。許可: ${[...allowed].join(', ')}${
      allowFullModelId ? ', または claude-* のフルモデル ID' : ''
    }`,
  );
}

// --- スキル検証 --------------------------------------------------------------

function validateSkills() {
  const skillsDir = join(claudeDir, 'skills');
  if (!existsSync(skillsDir)) return;

  const listingKeys = new Map();

  for (const entry of readdirSync(skillsDir)) {
    const dir = join(skillsDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const skillPath = join(dir, 'SKILL.md');
    const rel = `.claude/skills/${entry}/SKILL.md`;

    if (!existsSync(skillPath)) {
      add('ERROR', 'missing-skill-md', `.claude/skills/${entry}/`, 'SKILL.md がない');
      continue;
    }

    const raw = readFileSync(skillPath, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!parsed.ok) {
      add('ERROR', 'broken-frontmatter', rel, parsed.reason);
      continue;
    }

    const { fields } = parsed;
    checkUnknownFields(fields, SKILL_FIELDS, rel, 'スキル');

    // name はディレクトリ名と一致させる（省略時はディレクトリ名が採用される）
    const name = unquote(fields.name);
    if (typeof name === 'string' && name !== '' && name !== entry) {
      add(
        'WARN',
        'name-dir-mismatch',
        rel,
        `\`name: ${name}\` がディレクトリ名 \`${entry}\` と異なる。呼び出し名はディレクトリ名側になる`,
      );
    }

    // description は必須ではないが、ないとルーティングが本文頼みになる
    const description = typeof fields.description === 'string' ? fields.description : '';
    if (description.trim() === '') {
      add('WARN', 'missing-description', rel, 'description がない。ルーティング精度が落ちる');
    }

    const whenToUse = typeof fields.when_to_use === 'string' ? fields.when_to_use : '';
    const listingChars = description.length + whenToUse.length;
    if (listingChars > MAX_LISTING_CHARS) {
      add(
        'ERROR',
        'listing-truncated',
        rel,
        `description + when_to_use が ${listingChars} 文字。${MAX_LISTING_CHARS} 文字で切り捨てられ、超過分はルーティングに効かない`,
      );
    }

    const lineCount = raw.split(/\r?\n/).length;
    if (lineCount > MAX_SKILL_LINES) {
      add(
        'WARN',
        'skill-too-long',
        rel,
        `${lineCount} 行。${MAX_SKILL_LINES} 行を超える分は references/ へ分離を推奨`,
      );
    }

    checkEnum(fields, 'model', MODEL_ALIASES, rel, { allowFullModelId: true });
    checkEnum(fields, 'effort', EFFORT_LEVELS, rel);
    checkEnum(fields, 'shell', SHELLS, rel);

    if ('context' in fields && unquote(fields.context) !== 'fork') {
      add('ERROR', 'invalid-context', rel, '`context` に指定できるのは `fork` のみ');
    }
    if ('agent' in fields && !('context' in fields)) {
      add('WARN', 'agent-without-fork', rel, '`agent` は `context: fork` と併用しないと効かない');
    }
    if ('background' in fields && !('context' in fields)) {
      add('WARN', 'background-without-fork', rel, '`background` は `context: fork` のときのみ有効');
    }

    // 参照されていない assets/ references/ を検出（死蔵アセット）
    for (const sub of ['assets', 'references', 'examples', 'scripts']) {
      const subDir = join(dir, sub);
      if (!existsSync(subDir)) continue;
      if (!raw.includes(`${sub}/`)) {
        add(
          'WARN',
          'orphan-asset-dir',
          rel,
          `\`${sub}/\` が存在するが SKILL.md から参照されていない（死蔵アセット）`,
        );
      }
    }

    // description の先頭語が衝突していないか（ルーティング競合の粗い検出）
    const key = description.trim().slice(0, 24);
    if (key !== '') {
      if (listingKeys.has(key)) {
        add(
          'WARN',
          'description-collision',
          rel,
          `description の書き出しが ${listingKeys.get(key)} と重複している。ルーティングが競合しうる`,
        );
      } else {
        listingKeys.set(key, rel);
      }
    }
  }
}

// --- サブエージェント検証 ----------------------------------------------------

function validateAgents() {
  const agentsDir = join(claudeDir, 'agents');
  if (!existsSync(agentsDir)) return;

  const seenNames = new Map();

  for (const entry of readdirSync(agentsDir)) {
    if (!entry.endsWith('.md')) continue;
    const rel = `.claude/agents/${entry}`;
    const raw = readFileSync(join(agentsDir, entry), 'utf8');

    if (entry.endsWith('.agent.md')) {
      add(
        'WARN',
        'copilot-filename',
        rel,
        '`.agent.md` は GitHub Copilot の命名。Claude Code は `.md` を使う（識別は name フィールド由来なので動作はする）',
      );
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed.ok) {
      add('ERROR', 'broken-frontmatter', rel, parsed.reason);
      continue;
    }

    const { fields } = parsed;
    checkUnknownFields(fields, AGENT_FIELDS, rel, 'サブエージェント');

    const name = unquote(fields.name);
    if (!name) {
      add('ERROR', 'missing-name', rel, '`name` は必須');
    } else {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        add(
          'ERROR',
          'invalid-name',
          rel,
          `\`name: ${name}\` は小文字とハイフンのみ。\`:\` は使用不可`,
        );
      }
      if (seenNames.has(name)) {
        add('ERROR', 'duplicate-name', rel, `\`name: ${name}\` が ${seenNames.get(name)} と重複`);
      } else {
        seenNames.set(name, rel);
      }
    }

    const description = typeof fields.description === 'string' ? fields.description : '';
    if (description.trim() === '') {
      add('ERROR', 'missing-description', rel, '`description` は必須');
    }

    checkEnum(fields, 'model', MODEL_ALIASES, rel, { allowFullModelId: true });
    checkEnum(fields, 'effort', EFFORT_LEVELS, rel);
    checkEnum(fields, 'permissionMode', PERMISSION_MODES, rel);
    checkEnum(fields, 'memory', MEMORY_SCOPES, rel);
    checkEnum(fields, 'color', COLORS, rel);

    if ('isolation' in fields && unquote(fields.isolation) !== 'worktree') {
      add('ERROR', 'invalid-isolation', rel, '`isolation` に指定できるのは `worktree` のみ');
    }

    // 読み取り専用を宣言しているのに書き込みツールを持っていないか
    const tools = asList(fields.tools);
    const writeTools = tools.filter((tool) => ['Edit', 'Write', 'NotebookEdit'].includes(tool));
    const claimsReadOnly = /読み取り(専用|のみ)|read-only|never edits/i.test(
      `${description} ${raw.slice(0, 2000)}`,
    );
    if (claimsReadOnly && writeTools.length > 0) {
      add(
        'ERROR',
        'readonly-contradiction',
        rel,
        `読み取り専用と宣言しているが \`tools\` に ${writeTools.join(', ')} がある`,
      );
    }

    if (tools.length === 0 && !('tools' in fields)) {
      add(
        'WARN',
        'tools-unrestricted',
        rel,
        '`tools` 未指定は全ツール継承。役割に応じて絞ることを推奨',
      );
    }
  }
}

// --- フック配線の検証 --------------------------------------------------------

function validateHooks() {
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    add(
      'ERROR',
      'broken-settings-json',
      '.claude/settings.json',
      `JSON パース失敗: ${error.message}`,
    );
    return;
  }

  const hooks = settings.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const hook of entry.hooks ?? []) {
        const command = hook.command ?? '';
        // `node scripts/agent/foo.mjs` 形式のスクリプト実在確認
        const match = /(?:^|\s)((?:scripts|\.claude)[^\s"']+\.(?:mjs|js|ps1|sh|py))/.exec(command);
        if (!match) continue;
        const scriptPath = join(rootDir, match[1]);
        if (!existsSync(scriptPath)) {
          add(
            'ERROR',
            'missing-hook-script',
            '.claude/settings.json',
            `${event} フックが参照する ${match[1]} が存在しない`,
          );
        }
      }
    }
  }
}

// --- 移植元(だいどこ)の実資産を指す識別子の検出 ------------------------------

/**
 * 実行するとだいどこ側の資産を操作してしまう識別子。
 * 「だいどこ」という語の散文中の言及は対象外 — 操作対象になる値だけを落とす。
 *
 * 経緯: 移植時にアプリ ID とスキームは置換したが、Railway のサービス名と AdMob の
 * ユニット ID は grep パターンから漏れ、人手のレビューでしか見つからなかった。
 * 検出対象は下の配列が唯一の定義。行末に daidoko-ref-ok を書いた行は除外される。
 */
const FOREIGN_IDENTIFIERS = [
  { pattern: /com\.daidoko\.app/, label: 'だいどこの applicationId' }, // daidoko-ref-ok
  { pattern: /daidoko:\/\//, label: 'だいどこのディープリンクスキーム' }, // daidoko-ref-ok
  { pattern: /--service\s+daidoko\b/, label: 'だいどこの Railway サービス名' }, // daidoko-ref-ok
  { pattern: /daidoko-production/, label: 'だいどこの Railway 本番ドメイン' }, // daidoko-ref-ok
  { pattern: /ca-app-pub-2633806931583277/, label: 'だいどこの AdMob ID' }, // daidoko-ref-ok
  { pattern: /DAIDOKO_UPLOAD_/, label: 'だいどこの署名環境変数' }, // daidoko-ref-ok
  { pattern: /keisato848\/daidoko\b/, label: 'だいどこのリポジトリ' }, // daidoko-ref-ok
  { pattern: /daidoko\.db/, label: 'だいどこの DB ファイル名' }, // daidoko-ref-ok
];

// apps を含めるのは、SQLite のファイル名がアプリ本体に残っていたのを
// この検査が素通りさせたため。ハーネスだけ見ても実体は捕まえられない。
const SCAN_DIRS = ['.claude', 'scripts', 'e2e', 'apps'];
const SCAN_EXTENSIONS = /\.(md|mjs|js|ts|tsx|json)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.git')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

function validateForeignIdentifiers() {
  for (const dirName of SCAN_DIRS) {
    for (const file of walk(join(rootDir, dirName))) {
      const rel = file.replace(rootDir, '').replace(/\\/g, '/').replace(/^\//, '');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        // 意図的な参照は行末に daidoko-ref-ok を書いて除外する
        if (line.includes('daidoko-ref-ok')) return;
        for (const { pattern, label } of FOREIGN_IDENTIFIERS) {
          if (pattern.test(line)) {
            add(
              'ERROR',
              'foreign-app-identifier',
              `${rel}:${index + 1}`,
              `${label}が残っている。実行するとだいどこ側の資産を操作する。さいえん手帳の値かプレースホルダへ置き換えること`,
            );
          }
        }
      });
    }
  }
}

// --- 実行 --------------------------------------------------------------------

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
  };
}

if (!existsSync(claudeDir)) {
  console.error('.claude/ が見つかりません');
  process.exit(1);
}

validateSkills();
validateAgents();
validateHooks();
validateForeignIdentifiers();

const errors = findings.filter((finding) => finding.severity === 'ERROR');
const warnings = findings.filter((finding) => finding.severity === 'WARN');

if (options.json) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
} else {
  for (const finding of [...errors, ...warnings]) {
    console.log(`[${finding.severity}] ${finding.file}\n  (${finding.rule}) ${finding.message}`);
  }
  const verdict = errors.length === 0 ? 'OK' : 'NG';
  console.log(
    `\n[${verdict}] .claude カスタマイズ検証: ERROR ${errors.length} / WARN ${warnings.length}`,
  );
}

const failed = errors.length > 0 || (options.strict && warnings.length > 0);
process.exit(failed ? 1 : 0);

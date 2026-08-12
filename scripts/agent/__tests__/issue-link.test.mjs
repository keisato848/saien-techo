/**
 * PR–Issue 紐付けガードの単体テスト。
 *
 * **トリガー文字列をコマンドラインに書かない。** 素朴に
 * `node -e "...gh pr create..."` と書くと、その Bash 呼び出し自体を
 * PreToolUse ガードが deny する（docs/開発ハーネス.md に既出の罠。実際に踏んだ）。
 * ここではテスト対象の文字列をこのファイル内で組み立てて渡す。
 *
 * 実行: node scripts/agent/__tests__/issue-link.test.mjs
 */
import assert from 'node:assert/strict';

import { extractMergedPrNumber, inspectPrCreate, parseIssueRefs } from '../lib/issue-link.mjs';

// 文字列連結で組み立てる（このファイル自体が grep 検査に引っかかるのを避ける意図はない —
// あくまで可読性のため。deny されるのはコマンドラインであってファイル内容ではない）
const create = (title, body) => `gh pr create --title "${title}" --body "${body}"`;

const cases = [
  {
    name: 'WBS 番号あり・紐付けなし → deny',
    command: create('feat: 栽培詳細を直す (WBS 3.9)', '概要だけ書いた本文'),
    expectOk: false,
    expectWbs: '3.9',
  },
  {
    name: 'Closes あり → allow',
    command: create('feat: 栽培詳細を直す (WBS 3.9)', '概要\n\nCloses #26'),
    expectOk: true,
  },
  {
    name: 'Fixes でも allow（GitHub のクローズキーワード）',
    command: create('fix: トーストが出ない (WBS 2.8)', 'Fixes #92'),
    expectOk: true,
  },
  {
    name: 'Refs あり → allow（複数 PR にまたがる逃げ道）',
    command: create('feat: AI 相談 (WBS 3.10/3.11)', 'Refs #27'),
    expectOk: true,
  },
  {
    name: 'Issue なし宣言 → allow',
    command: create('chore: フック整備 (WBS T3)', 'Issue: なし（ハーネス調整のため）'),
    expectOk: true,
  },
  {
    name: 'WBS 番号なしの PR は対象外 → allow',
    command: create('docs: 手順の誤記を直す', '概要だけ'),
    expectOk: true,
  },
  {
    name: 'T 番号（T1/T2/T3）も対象',
    command: create('test: 画面テストを足す (WBS T1)', '概要だけ'),
    expectOk: false,
    expectWbs: 'T1',
  },
  {
    name: 'PR 作成以外のコマンドは素通り',
    command: 'gh pr list --state open',
    expectOk: true,
  },
];

let failed = 0;
for (const testCase of cases) {
  const result = inspectPrCreate(testCase.command);
  try {
    assert.equal(result.ok, testCase.expectOk, `ok が期待と違う: ${JSON.stringify(result)}`);
    if (testCase.expectWbs) assert.equal(result.wbs, testCase.expectWbs);
    console.log(`  PASS  ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${testCase.name}\n        ${error.message}`);
  }
}

// マージ検出
const mergeCases = [
  { command: 'gh pr merge 104 --merge', expected: '104' },
  { command: 'gh pr list', expected: null },
];
for (const testCase of mergeCases) {
  const actual = extractMergedPrNumber(testCase.command);
  try {
    assert.equal(actual, testCase.expected);
    console.log(`  PASS  マージ検出: ${testCase.command}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  マージ検出: ${testCase.command}\n        ${error.message}`);
  }
}

// 本文の Issue 参照抽出（PostToolUse 検証が使う）
const parseCases = [
  {
    name: 'Closes と Refs を区別する',
    body: '概要\n\nCloses #26\nRefs #27',
    expected: { closes: ['26'], refs: ['27'] },
  },
  {
    name: '複数の Closes を拾い、重複は畳む',
    body: 'Closes #1\nFixes #2\nResolves #1',
    expected: { closes: ['1', '2'], refs: [] },
  },
  {
    name: '紐付けが無ければ空',
    body: 'ただの本文。#123 のような裸の番号は拾わない',
    expected: { closes: [], refs: [] },
  },
  { name: 'body が undefined でも落ちない', body: undefined, expected: { closes: [], refs: [] } },
];
for (const testCase of parseCases) {
  try {
    assert.deepEqual(parseIssueRefs(testCase.body), testCase.expected);
    console.log(`  PASS  参照抽出: ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  参照抽出: ${testCase.name}\n        ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log('\nすべて通過');

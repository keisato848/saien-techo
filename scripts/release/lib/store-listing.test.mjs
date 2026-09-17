/**
 * parseWhatsNew の境界ケース。実行: `pnpm test:scripts`（node --test）。
 *
 * 1.1（2026-08-23）で ASC の What's New を手で貼らずに済ませるため、
 * 掲載文 §6 の見出し規約（`### v1.1（今回）`）をここで固定する。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFencedSection, parseWhatsNew } from './store-listing.mjs';

const MD = `## §6 リリースノート

### v1.1（今回）

\`\`\`
収穫の記録が写真だけで終わるようになりました。

・収穫の写真から作物と個数を読み取って、記録の下書きにします
\`\`\`

### v1.0（提出済み）

\`\`\`
さいえん手帳のはじめてのリリースです。
\`\`\`
`;

test('app.json の 1.1.0 で「### v1.1（今回）」を拾う（末尾 .0 を落として一致）', () => {
  const out = parseWhatsNew(MD, '1.1.0');
  assert.ok(out?.startsWith('収穫の記録が写真だけで終わるようになりました。'));
  assert.ok(out?.includes('・収穫の写真から'));
});

test('完全一致（1.0）でも拾える', () => {
  assert.equal(parseWhatsNew(MD, '1.0'), 'さいえん手帳のはじめてのリリースです。');
});

test('見出しの補足（（今回）/（提出済み））があっても一致する', () => {
  assert.notEqual(parseWhatsNew(MD, '1.0'), null);
  assert.notEqual(parseWhatsNew(MD, '1.1'), null);
});

test('無いバージョンは null（勝手に別版の文面を使わない）', () => {
  assert.equal(parseWhatsNew(MD, '9.9.9'), null);
});

test('コードブロックの外の行は含めない', () => {
  const out = parseWhatsNew(MD, '1.1.0');
  assert.ok(!out.includes('### v1.0'));
  assert.ok(!out.includes('```'));
});

test('本文は trim される（先頭・末尾の空行を持ち込まない）', () => {
  const out = parseWhatsNew(MD, '1.1.0');
  assert.equal(out, out.trim());
});

/* ---------------- parseFencedSection ---------------- */

const LISTING = `# App Store 掲載情報

## §2 サブタイトル（30 文字）

\`\`\`
畑もプランターも。野菜づくりの栽培暦
\`\`\`

説明の文章。ここは拾わない。

## §3 プロモーションテキスト（170 文字）

\`\`\`
標語をここに置く。
\`\`\`

## §4 キーワード（100 文字）

\`\`\`
畑,市民農園,トマト
\`\`\`

## §5 説明（4000 文字）

コードブロックが無い節。
`;

test('parseFencedSection は見出し直下の最初のコードブロックだけを取る', () => {
  assert.equal(parseFencedSection(LISTING, 'サブタイトル'), '畑もプランターも。野菜づくりの栽培暦');
  assert.equal(parseFencedSection(LISTING, 'プロモーションテキスト'), '標語をここに置く。');
  assert.equal(parseFencedSection(LISTING, 'キーワード'), '畑,市民農園,トマト');
});

test('parseFencedSection は次の見出しを越えて拾わない', () => {
  // §5 にはコードブロックが無い。**越えて §2 や §4 のものを拾ってはいけない**
  assert.equal(parseFencedSection(LISTING, '説明'), null);
  assert.equal(parseFencedSection(LISTING, 'ありえない見出し'), null);
  assert.equal(parseFencedSection('', 'サブタイトル'), null);
  assert.equal(parseFencedSection(null, 'サブタイトル'), null);
});

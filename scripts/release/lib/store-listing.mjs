/**
 * ストア掲載文（Markdown）から提出に使う断片を取り出す純関数。
 * ネットワークも FS も触らない（テストしやすくするため）。
 *
 * - Play のリリースノート: `docs/store/google-play/listing-ja.md` の「## リリースノート」節
 *   （submit-play-release.mjs が読む。**節の中に HTML コメントを置くとそのまま送られる**）
 * - ASC の What's New: `docs/store/app-store/listing-ja.md` §6 の `### vX.Y` 配下の ``` ブロック
 */

/**
 * App Store 掲載文 §6 から、指定バージョンの What's New を取り出す。
 *
 * 見出しは `### v1.1（今回）` のように補足が付くので、`### v<version>` で前方一致させる。
 * バージョンは `1.1.0` と `1.1` のどちらで書かれていても拾えるよう、
 * 末尾の `.0` を落とした形も試す（v1.1.0 → v1.1）。
 *
 * @param {string} markdown
 * @param {string} version  app.json の version（例: "1.1.0"）
 * @returns {string|null} 本文（trim 済み）。見つからなければ null
 */
export function parseWhatsNew(markdown, version) {
  const candidates = [version, version.replace(/\.0$/, '')].filter((v, i, a) => a.indexOf(v) === i);
  for (const v of candidates) {
    const re = new RegExp(
      `^### v${escapeRegExp(v)}(?:[^\\n]*)\\n+\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``,
      'm',
    );
    const m = markdown.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** ASC の What's New は 4000 字まで。Play と同じ文面でも上限が違うので両方見る */
export const WHATS_NEW_MAX = 4000;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `## §N 見出し` 直下の最初のコードブロックを取り出す。
 *
 * サブタイトル・プロモーションテキスト・キーワードのように、**listing-ja.md を
 * 唯一の正と書きながら、どの経路でも送られていなかった**欄を拾うために足した。
 * 実測（2026-09-17）では 1.3.0 までプロモーションテキストが空のままだった。
 */
export function parseFencedSection(md, headingFragment) {
  const re = new RegExp(`^## [^\\n]*${headingFragment}[^\\n]*$`, 'm');
  const m = re.exec(String(md ?? ''));
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  // **次の見出しより前だけを見る。** 見ないと別の節のコードブロックを拾う
  const nextHeading = rest.search(/^## /m);
  const scope = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const fence = /```[a-z]*\n([\s\S]*?)\n```/.exec(scope);
  return fence ? fence[1].trim() : null;
}

/**
 * 手順書（`.claude/**` と `docs/**`）が書いている**リポジトリ相対パス**の抽出。
 *
 * 経緯: 1.1 のリリース作業で、`release-verify` が参照する
 * `scripts/release/check-elf-align.py` と `update-store-listing` が参照する
 * `update-play-icon.mjs` / `update-play-feature-graphic.mjs` が
 * **このリポジトリに存在しなかった**（移植元にしか無い / 別名へ統合済み）。
 * CLAUDE.md は「だいどこ固有の参照は解消済み」としていたが、当時の確認は
 * 「だいどこの実資産を触る参照」だけを見ており、**「ここに無いファイルを指す参照」は
 * 見ていなかった**（docs/レビュー記録/2026-08-22-release-1.1-retrospective.md B-2〜B-4）。
 *
 * 手順書は実行されないので、間違っていても誰も落ちない。**作業中に人が気づくまで
 * 見つからない**ため、機械で見張る。
 *
 * ここは**抽出だけ**を行う純関数の置き場（実在確認と gitignore の判定は
 * validate-claude-customizations.mjs 側）。テストしやすさのために分けている。
 */

/** パスの先頭に来るリポジトリ直下のディレクトリ。ここに無い接頭辞は見ない */
const TOP_LEVEL = [
  'scripts',
  'apps',
  'docs',
  'e2e',
  'packages',
  'infra',
  'mockup',
  '\\.claude',
  '\\.github',
  '\\.githooks',
];

/**
 * パスとみなす並び。
 *
 * - 直前が `\w . / \ ~ -` のときは拾わない。これで **URL の一部**
 *   （`https://code.claude.com/docs/en/skills`）、**ホーム配下**
 *   （`~/.claude/projects/...`）、**散文の区切り**（`feat/fix/docs/chore`）が落ちる
 * - 終端に `* { } ( ) [ ] | \ , ; 空白 引用符` と全角の `（） 「」 、。・…` を置く。
 *   glob・ブレース展開・正規表現交じりの表記（`.claude/(agents|skills)/**`）は
 *   そこで切れ、あとの「拡張子か / で終わること」の条件で捨てられる
 */
const PATH_PATTERN = new RegExp(
  `(?<![\\w./\\\\~-])(?:${TOP_LEVEL.join('|')})\\/[^\\s\`"'()<>{}|,;*\\\\\\[\\]（）「」、。・…]*`,
  'g',
);

/** この行（またはファイル）は見ない、という印。理由を添えて書く */
export const ESCAPE_MARKER = 'path-ref-ok';

/** 移植元（だいどこ）の資産を指す意図的な参照の印。既存の検査と共通 */
const FOREIGN_MARKER = 'daidoko-ref-ok';

/**
 * ファイル全体を対象外にする宣言。`<!-- path-ref-ok: 理由 -->` を先頭付近に置く。
 * **停止中のスキル**のように、ファイルまるごとが移植元の値のままで、
 * 差し替えるまでパスが実在しないと分かっているものに使う。
 */
export function fileIsExempt(source) {
  return new RegExp(`<!--\\s*${ESCAPE_MARKER}\\s*:\\s*\\S`).test(source);
}

/** 末尾に付いた句読点・行番号（`docs/WBS.md:198-202`）を落とす */
function trimTail(candidate) {
  return candidate.replace(/:\d+(-\d+)?$/, '').replace(/[.,:;)]+$/, '');
}

/**
 * 実在を確かめる価値のある形か。
 *
 * ディレクトリ参照（`scripts/release/`）か、拡張子付きのファイル名で終わるものだけを見る。
 * `apps/mobile/src/db/schema`（`schema\|migrate.ts` の前半）のような
 * **途中で切れた断片**を弾くのが目的。
 */
function looksLikePath(candidate) {
  return candidate.endsWith('/') || /\.[A-Za-z0-9]{1,6}$/.test(candidate);
}

/**
 * 1 ファイル分のテキストから、リポジトリ相対パスの参照を拾う。
 * 返すのは `{ path, line }`（line は 1 始まり）。実在確認はしない。
 */
export function extractRepoPathRefs(source) {
  if (fileIsExempt(source)) return [];

  const refs = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(ESCAPE_MARKER) || line.includes(FOREIGN_MARKER)) return;

    for (const match of line.matchAll(PATH_PATTERN)) {
      // 「だいどこの `docs/クラウド同期設計.md`」のように、同じ行の**手前**で
      // 移植元だと断ってあるものは向こうのツリーの話なので見ない。
      if (/だいどこ|daidoko/.test(line.slice(0, match.index))) continue;

      const path = trimTail(match[0]);
      if (!looksLikePath(path)) continue;
      refs.push({ path, line: index + 1 });
    }
  });
  return refs;
}

/**
 * 検査の自己診断に使う対照。**上が「検出できるはず」、下が「検出してはいけない」。**
 *
 * 検証コードのバグで「0 件 = 合格」を誤報しかけた実績がこのリポジトリに 2 回ある
 * （CRLF による frontmatter 取りこぼし、Hermes バイトコードへの grep）ので、
 * 走らせるたびにこの対照で仕組み自体を確かめる。
 */
export const SELF_TEST = {
  detected: [
    '手順は `scripts/release/does-not-exist.mjs` を実行する',
    '正は [掲載順](docs/store/does-not-exist.md) を見る',
    '素材は `scripts/release/no-such-dir/` に置く',
  ],
  ignored: [
    '仕様は https://code.claude.com/docs/en/skills を参照',
    'セッション横断の知見は `~/.claude/projects/C--x/memory/` に置く',
    'コミットは `feat:` `fix:` `docs:` を使う',
    'フックの実体は `scripts/agent/hook-*.mjs`',
    'Copilot 用資産は `.github/{skills,agents}/` に置く',
    'だいどこの `docs/クラウド同期設計.md` と共通化を検討',
    '将来 `docs/まだ無い設計.md` を作る予定 path-ref-ok（未作成）',
  ],
};

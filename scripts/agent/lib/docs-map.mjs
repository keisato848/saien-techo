/**
 * 「このファイルを変更したら、このドキュメント/Skill の更新を検討する」対応表。
 * hook-posttool-docs-reminder（編集直後の注入）と hook-stop-docs-guard
 * （ターン終了時の未更新チェック）で共有する。
 */
export const DOC_RULES = [
  {
    pattern: /^(scripts\/agent\/hook-|\.githooks\/|\.claude\/settings\.json$)/,
    target: 'docs/開発ハーネス.md（フック一覧）',
  },
  {
    pattern: /^scripts\/agent\/(build-android|device-shot|preflight|install-apk)/,
    target: 'docs/開発ハーネス.md と docs/リリース手順.md',
  },
  {
    pattern: /^scripts\/release\//,
    target: 'docs/リリース手順.md §3 と .claude/skills/update-store-listing',
  },
  {
    pattern: /^(railway\.json|apps\/server\/Dockerfile)$/,
    target: 'docs/リリース手順.md §1 と .claude/skills/deploy-server',
  },
  {
    pattern: /^apps\/mobile\/eas\.json$/,
    target: 'docs/リリース手順.md §2 と .claude/skills/release-play',
  },
  {
    pattern: /^\.claude\/(agents|skills)\//,
    target: 'docs/開発ハーネス.md §1 構成マップ',
  },
  {
    // 推論・無料枠・広告・サーバー接続先に触る変更は「誰がいくら払うか」が変わる。
    // 設計時・実装時・提出前に 3 つの数字（1 回 / 1 人・月 / 天井・月）を出して
    // §5 に追記する（.claude/skills/cost-impact）。1.1 提出直前に初めて分析した反省（#157）。
    pattern:
      /^(apps\/mobile\/src\/services\/(garden-consult|harvest-read|planting-identify|usage|identify-credit|ad-reward)[^/]*\.ts|apps\/mobile\/src\/config\.ts|apps\/mobile\/eas\.json|apps\/server\/src\/lib\/rate-limit\.ts)$/,
    target:
      'docs/インフラ・NW構成設計.md §5（コスト試算）— .claude/skills/cost-impact の手順で分析・報告',
  },
  // NOTE: apps/server/src/routes/ → docs/アーキテクチャ設計.md と
  // apps/mobile/src/db/(schema|migrate).ts → docs/データ設計.md の 2 件は
  // 督促先が存在しないため外してある（実体は移植元の docs/参考-daidoko/ 配下で、
  // さいえん手帳版は未作成）。存在しないファイルの更新を毎回督促していた。
  // WBS 1.3（データ設計・DB スキーマ）でさいえん手帳版を作成したら復活させる。
];

/** ドキュメント側とみなすパス（これが同時に変更されていれば督促しない） */
export const DOC_TARGET_HINT = /^(docs\/|\.claude\/(skills|agents)\/|CLAUDE\.md$)/;

/** リポジトリ相対パスに正規化（Windows 絶対パス・バックスラッシュ対応） */
export function toRepoRelative(filePath, rootDir) {
  if (typeof filePath !== 'string' || !filePath) return '';
  let p = filePath.replace(/\\/g, '/');
  const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    p = p.slice(root.length + 1);
  }
  return p;
}

/** 変更ファイル群に対する督促対象（重複除去済み）を返す */
export function matchDocTargets(files) {
  const targets = new Set();
  const hits = [];
  for (const file of files) {
    for (const rule of DOC_RULES) {
      if (rule.pattern.test(file)) {
        if (!targets.has(rule.target)) {
          targets.add(rule.target);
        }
        hits.push({ file, target: rule.target });
      }
    }
  }
  return { targets: [...targets], hits };
}

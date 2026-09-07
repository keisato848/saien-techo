/**
 * 「端末の外へ出す機能」と「申告している機能」がずれていないことの横断チェック。
 *
 * `docs/store/google-play/data-safety.md` の冒頭には
 * 「申告内容を変える変更を入れたら、必ずこのファイルも直すこと」と書いてある。
 * **それでも守られなかった。** #148（収穫写真を `/garden/harvest` へ送る）では
 * プライバシーポリシー §4 が AI 相談だけを説明したまま出荷され、
 * 1.2 の `/garden/identify`（写真から栽培を登録）でも両方の文書が 2 機能のまま残った。
 * しかも **UI では AI と名乗らない**（#143 の決定）ので、**利用者はこのずれに
 * 気づく手段がない**（docs/レビュー記録/2026-08-22-release-1.1-retrospective.md B-1）。
 *
 * 散文の規約は守られない。`KeyboardAvoider` カバレッジテストと同じ発想で、
 * **規約を機械へ移す**。落ちたときに直すのは、まず**文書のほう**
 * （送信を減らすのでなければ、実装は正しくて申告が遅れている）。
 *
 * ここが見ているのは 3 つ。
 *   1. 外へ出す通信は**すべて `API_V1` 経由**である（別の宛先が生えていない）
 *   2. 叩いているエンドポイントの**顔ぶれ**が data-safety.md の表と一致する
 *   3. 2 つの文書が書いている**機能の数**が、実装の数と一致する
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOBILE_SRC = resolve(__dirname, '../..');
const REPO_ROOT = resolve(__dirname, '../../../../..');
const DATA_SAFETY = join(REPO_ROOT, 'docs/store/google-play/data-safety.md');
const PRIVACY_POLICY = join(REPO_ROOT, 'docs/プライバシーポリシー.md');

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      collectSources(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sources = collectSources(MOBILE_SRC).map((path) => ({
  key: path
    .slice(MOBILE_SRC.length + 1)
    .split(/[\\/]/)
    .join('/'),
  source: readFileSync(path, 'utf8'),
}));

/** `${API_V1}/garden/consult` のような組み立て方から、エンドポイントの道筋を拾う */
function endpointsIn(source: string): string[] {
  return [...source.matchAll(/\$\{API_V1\}(\/[A-Za-z0-9/_-]+)/g)].map((match) => match[1]);
}

const codeEndpoints = [...new Set(sources.flatMap((file) => endpointsIn(file.source)))].sort();

/**
 * `fetch(...)` / `fetchFn(...)` の呼び出し位置。第 1 引数のあたりに `API_V1` が
 * 無ければ、**申告の対象外の宛先**へ出ている可能性がある。
 * `refetch` / `prefetchQuery` は語の途中なので `(?<![A-Za-z0-9_])` で外れる。
 */
const nonApiV1Fetches = sources.flatMap((file) =>
  [...file.source.matchAll(/(?<![A-Za-z0-9_])fetch(?:Fn)?\s*\(/g)]
    .filter(
      (match) => !file.source.slice(match.index ?? 0, (match.index ?? 0) + 120).includes('API_V1'),
    )
    .map((match) => `${file.key}:${file.source.slice(0, match.index ?? 0).split('\n').length}`),
);

/** `## <番号>.` から次の `## ` までを切り出す */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`見出しが見つからない: ${heading}（文書の構成が変わった？）`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * 機能 1 つ = 表の 1 行。
 *
 * data-safety.md §3 には「機能の表」と「申告項目の表」の 2 つがあるので、
 * **エンドポイントが書いてある行**だけを機能行とみなす。
 * プライバシーポリシー §4 は表が 1 つで、機能名を太字で書く決まり
 * （見出し行と区切り行はどちらにも当たらないので落ちる）。
 */
function featureRows(markdownSection: string, marker: RegExp): string[] {
  return markdownSection
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|') && marker.test(line));
}

const ENDPOINT_ROW = /`\/[a-z0-9/_-]+`/;
const BOLD_NAME_ROW = /\*\*/;

const dataSafety = readFileSync(DATA_SAFETY, 'utf8');
const privacyPolicy = readFileSync(PRIVACY_POLICY, 'utf8');
const dataSafetySection = section(dataSafety, '## 3. 写真を送る機能');
const privacySection = section(privacyPolicy, '## 4. 写真を送る機能について');

/** data-safety.md §3 の機能表が申告しているエンドポイント */
function declaredEndpoints(markdownSection = dataSafetySection): string[] {
  const found = featureRows(markdownSection, ENDPOINT_ROW).map(
    (row) => ENDPOINT_ROW.exec(row)?.[0].replaceAll('`', '') ?? '',
  );
  return [...new Set(found)].sort();
}

describe('外部送信と申告の対応', () => {
  it('走査対象を実際に見つけている（パス解決が壊れたら気づく）', () => {
    // 「0 件だから合格」を防ぐ正の対照。src が見つからないと全部素通りする
    expect(sources.length).toBeGreaterThan(50);
    expect(codeEndpoints.length).toBeGreaterThan(0);
  });

  it('外への通信はすべて API_V1 経由（申告していない宛先が生えていない）', () => {
    // ここが落ちたら、まず「本当に外へ出す必要があるか」を考える。
    // 出すなら config.ts の API_V1 を通し、下の 2 つの文書にも足すこと。
    expect(nonApiV1Fetches).toEqual([]);
  });

  it('叩いているエンドポイントが data-safety.md §3 の表に全部載っている', () => {
    // **本文ではなく表の行から拾う。** 節のどこかに名前が出ていれば通る作りにすると、
    // 「注記で触れただけ」で申告済みになってしまう（実際そうなりかけた）。
    const declared = declaredEndpoints();
    // 差分をそのまま出す。どちらに足りないかが分かるほうが直しやすい
    expect(declared).toEqual(codeEndpoints);
  });

  it('data-safety.md §3 が書いている機能の数が、実装の数と一致する', () => {
    const stated = /写真を端末外へ送る機能は\s*(\d+)\s*つ/.exec(dataSafetySection)?.[1];
    expect(Number(stated)).toBe(codeEndpoints.length);
    expect(featureRows(dataSafetySection, ENDPOINT_ROW)).toHaveLength(codeEndpoints.length);
  });

  it('プライバシーポリシー §4 が書いている機能の数が、実装の数と一致する', () => {
    const stated = /写真を端末の外へ送る機能が\s*(\d+)\s*つ/.exec(privacySection)?.[1];
    expect(Number(stated)).toBe(codeEndpoints.length);
    expect(featureRows(privacySection, BOLD_NAME_ROW)).toHaveLength(codeEndpoints.length);
  });

  it('文書の突き合わせ自体が動く（合成した「申告漏れ」を検出できる）', () => {
    // 上の 3 つは「今たまたま一致している」だけかもしれない。
    // 機能を 1 つ削った文書を食わせて、ちゃんと数が合わなくなることを確かめる。
    // 表から 1 行落とすと、数が合わなくなる
    const oneShort = featureRows(dataSafetySection, ENDPOINT_ROW).slice(0, -1);
    expect(oneShort.length).not.toBe(codeEndpoints.length);

    // 表の行を書き換えると、顔ぶれが合わなくなる（本文の言及では埋め合わせられない）
    const brokenSection = dataSafetySection.replace(ENDPOINT_ROW, '`/garden/renamed`');
    expect(declaredEndpoints(brokenSection)).not.toEqual(codeEndpoints);
  });
});

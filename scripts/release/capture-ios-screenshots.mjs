/**
 * App Store 掲載用スクリーンショットを iOS シミュレータから機械的に取得する（macOS 専用）。
 *
 * 仕組み: 各ショットごとに「アプリを terminate → Expo Router のディープリンク
 * (saientecho://...) で起動 → アプリが前面に出たことを確認 → 待機 →
 * xcrun simctl io screenshot」。
 * ステータスバーは simctl status_bar override で固定（時計 9:41・電池 100%・WiFi/電波フル）。
 * Android 版（capture-store-screenshots.mjs）の iOS 対応版。ANR/SystemUI ダイアログは
 * iOS シミュレータには無いので、そのぶん単純。
 *
 * **iOS 17+ の URL 確認ダイアログについて（2026-08-14・iOS 18.5 実測）**
 *   `simctl openurl` でカスタムスキームを開くと、SpringBoard が
 *   「"さいえん手帳" で開きますか?」の確認を出す。**誰かが「開く」を押すまで
 *   アプリは起動しない。** しかもこのダイアログは毎回出るとは限らず、
 *   直前に確定していると一定時間は抑制される（＝出たり出なかったりする）。
 *   `simctl` に入力注入は無く（`simctl help` の全サブコマンドを確認済み）、
 *   AppleScript のクリックは補助アクセス許可が要るため自動化できない。
 *
 *   そこでこのスクリプトは **撮る前にアプリが前面に出たことを毎回確認する**。
 *   ダイアログで止まっていれば待ち続け、操作者に「開く」を押すよう促す。
 *   タイムアウトしたらそのショットは FAILED にして、最後に非ゼロ終了する。
 *
 *   これは「黙って撮れてしまう」事故への対策でもある。以前の実装は PNG として
 *   壊れていないかしか見ておらず、7 枚とも「ホーム画面＋確認ダイアログ」を撮った
 *   うえで captured と報告した（2026-08-14）。ストアに出す寸前まで気付けない。
 *
 * 前提（macOS + Xcode）:
 *   - Xcode + iOS シミュレータ、Node/pnpm セットアップ済み（docs/リリース手順.md §7・ios-release Skill）
 *   - ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータに導入済み:
 *       LANG=en_US.UTF-8 EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
 *         pnpm --filter mobile exec expo run:ios --configuration Release --device <UDID>
 *     （LANG が未設定だと CocoaPods が Encoding::CompatibilityError で落ちる）
 *     （または EAS の simulator ビルドを `xcrun simctl install booted <App.app>`）
 *   - **`expo run:ios` には必ず `--device <UDID>` を渡す。** 付けないと端末選択の
 *     対話プロンプトで止まり、**非対話環境（エージェント実行・stdin が /dev/null）では
 *     無反応のまま固まる**（2026-08-27 に別リポジトリで 14 分・CPU 0.94 秒・
 *     子プロセスなしで停止したのを実測）。`script` で擬似端末を与えても
 *     stdin が EOF になって即終了する。通らないときは `xcodebuild` を直接叩く
 *   - **`ios/` は壊れることがある。** `app 2` / `Pods 2` のような重複ディレクトリが
 *     残ると `EXPermissionsRequester.h` が見つからず
 *     `could not build Objective-C module 'EXNotifications'` で落ちる。
 *     `Podfile.lock` と `Manifest.lock` は一致したままなので CocoaPods は気づかない。
 *     **ローカルでビルドする前に `expo prebuild --platform ios --clean` を通す。**
 *     EAS はクラウドも `--local` も一時コピーで prebuild し直すので表面化しない
 *   - スクショ用シミュレータを1台だけ Boot しておく（推奨: iPhone 16 Pro Max = 6.9"/1320x2868）:
 *       xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
 *   - オンボーディング（地域選択）は済ませておく。未完了だとどのルートを開いても
 *     ようこそ画面が出る。
 *     **`simctl uninstall` するとここもやり直しになる**（アプリコンテナごと消えるので
 *     完了フラグも消える。2026-08-27 に踏んだ）。シードを入れ直すために uninstall した
 *     あとは、**必ず人が「はじめる」を 1 タップする**こと — `simctl` に入力注入は無い。
 *     地域は既定の「中間地」のまま触らない（掲載スクショの「8月の菜園仕事」と揃うため）
 *
 * 使い方:
 *   node scripts/release/capture-ios-screenshots.mjs [--udid <udid>] [--shots 01,02]
 *     [--out <dir>] [--planting <id>] [--keep-status-bar] [--wait <ms>]
 *     [--dialog-timeout <ms>]
 *
 * manual 指定のショット（AI 実行結果など自動遷移できない画面）はスキップし、
 * 既存ファイルを維持する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { appIdentity } from '../agent/lib/app-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = path.join(ROOT, 'docs/store/app-store/phone-screenshots');
const { bundleId: BUNDLE_ID, scheme: SCHEME } = appIdentity();

if (process.platform !== 'darwin') {
  console.error('このスクリプトは macOS 専用です（xcrun simctl を使用）。Mac で実行してください。');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
/** サンプルデータの栽培 ID（src/db/seed.ts）。--planting で差し替えられる */
const PLANTING_ID = args.planting ?? 'planting-tomato-01';

/**
 * 画面の粗い指紋（16x16 グレースケール）どうしの平均絶対差。
 *
 * 2026-08-14 の実測（iPhone 16 Pro Max）:
 *   ホーム画面(SpringBoard) vs アプリの7画面 = 108〜127
 *   アプリ画面どうしの最小 = 2.9（栽培一覧 vs 資材。どちらもリスト＋チップ）
 * この開きを使って「アプリが前面に出たか」と「同じ画面を撮っていないか」を見る。
 */
const SPRINGBOARD_DISTANCE = 40; // これ以下なら「まだ SpringBoard を見ている」
const DUPLICATE_DISTANCE = 1.0; // これ以下なら実質同じ画面

/**
 * ショット定義。route は Expo Router のパス（saientecho://<route> で開く）。
 *
 * **Android 版（capture-store-screenshots.mjs）と同じ画面構成・同じ順序に揃える。**
 * 掲載順の正は `docs/store/google-play/README.md` と
 * `scripts/release/update-play-screenshots.mjs` の ORDER 配列。
 * ずらすと 2 ストアで「同じアプリの別の顔」ができてしまう。
 */
// **撮れたかはファイルサイズで判断する。** 中身が出ていれば 100KB 前後〜、
// **20KB 前後ならローディングのスピナーしか写っていない**
// （Android 側で 2026-08-22 に 8 枚全滅。既定の待ちが短かった）。
const SHOTS = [
  { file: '01-home.png', route: '', label: 'ホーム（今日の菜園）' },
  { file: '02-plantings.png', route: 'plantings', label: '栽培一覧' },
  { file: '03-planting-detail.png', route: `plantings/${PLANTING_ID}`, label: '栽培詳細' },
  { file: '04-harvests.png', route: 'harvests', label: '収穫アルバム' },
  { file: '05-crop-guide.png', route: 'crops', label: '作物ガイド' },
  { file: '06-calendar.png', route: 'calendar', label: 'カレンダー' },
  { file: '07-materials.png', route: 'materials', label: '資材の在庫' },
  // 1.1 の目玉（#148）。シードが「読み取り済み 1・待ち 1」を用意している（I8 §2）
  { file: '08-harvest-reads.png', route: 'harvests/reads', label: '写真から記録（読み取り待ち）' },
  // 1.2 の目玉（#152）。**ドラフトは DB に持たないのでシードで埋められない** —
  // 撮れるのは入口の空状態（「育てているものを撮って登録」）。
  // 中身の詰まった画面が要るなら、リワードを見て実際に読み取らせるしかない。
  { file: '09-planting-identify.png', route: 'plantings/identify', label: '写真から栽培を登録' },
  // 1.2 の目玉（#161）。同じ栽培の写真を 2 枚並べて経過日数の差を出す。
  // **栽培詳細では折り返しの下**にあるので、直リンクで撮る
  // （simctl にスクロール手段が無く、Android だけスクロールすると両ストアで絵が変わる）。
  { file: '10-growth-record.png', route: `plantings/${PLANTING_ID}/compare`, label: '成長記録' },
];

const udid = args.udid ?? autoSelectBootedUdid();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'saien-shots-'));
fs.mkdirSync(outDir, { recursive: true });

console.log(`simulator: ${udid}`);
ensureAppInstalled();

const selected = SHOTS.filter(
  (s) => !args.shots || args.shots.some((prefix) => s.file.startsWith(prefix)),
);

if (!args.keepStatusBar) overrideStatusBar();
const results = [];
try {
  // アプリを畳んだ状態＝SpringBoard を基準として押さえる。
  // 以降のショットがこれに近ければ「アプリが前面に出ていない」と判定できる。
  const springboard = await captureSpringboardReference();

  for (const shot of selected) {
    if (shot.manual) {
      console.log(`SKIP (manual): ${shot.file} — ${shot.label}`);
      results.push({ ...shot, status: 'manual-skip' });
      continue;
    }
    await captureShot(shot, springboard);
  }
} finally {
  if (!args.keepStatusBar) clearStatusBar();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

await reportDuplicates();

console.log('\n=== summary ===');
for (const r of results) {
  console.log(
    `${r.status.padEnd(12)} ${r.file}  ${r.size ?? ''}${r.reason ? `  ${r.reason}` : ''}`,
  );
}
const failed = results.filter((r) => r.status === 'FAILED');
if (failed.length) {
  console.error(`\n${failed.length} 枚が撮れていません。掲載前に必ず解消すること。`);
}
process.exit(failed.length ? 1 : 0);

// ─── capture ─────────────────────────────────────────────────────────────────

async function captureSpringboardReference() {
  simctl(['terminate', udid, BUNDLE_ID]); // 未起動でも無害（失敗は無視）
  await sleep(2500);
  const dest = path.join(tmpDir, 'springboard.png');
  const cap = simctl(['io', udid, 'screenshot', '--type=png', dest]);
  if (!cap.ok || !fs.existsSync(dest)) {
    throw new Error(`SpringBoard の基準スクショに失敗: ${cap.output.slice(0, 200)}`);
  }
  return await fingerprint(dest);
}

async function captureShot(shot, springboard) {
  const url = `${SCHEME}://${shot.route}`;
  // 一度終了してからディープリンクで開くと、確実に対象画面へ遷移できる。
  simctl(['terminate', udid, BUNDLE_ID]);
  await sleep(1200);
  const open = simctl(['openurl', udid, url]);
  if (!open.ok) {
    console.error(`FAILED to open ${url}: ${open.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED', reason: 'openurl が失敗' });
    return;
  }

  const foreground = await waitForForeground(springboard, shot);
  if (!foreground) {
    results.push({
      ...shot,
      status: 'FAILED',
      reason: 'アプリが前面に出なかった（URL 確認ダイアログ？）',
    });
    return;
  }

  await sleep(args.waitMs); // データ読込＋アニメーション静定

  const dest = path.join(outDir, shot.file);
  const cap = simctl(['io', udid, 'screenshot', '--type=png', dest]);
  if (!cap.ok || !fs.existsSync(dest)) {
    console.error(`FAILED screenshot for ${shot.file}: ${cap.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED', reason: 'screenshot が失敗' });
    return;
  }
  const buf = fs.readFileSync(dest);
  if (buf.length < 1000 || buf.readUInt32BE(0) !== 0x89504e47) {
    console.error(`FAILED (not a PNG) for ${shot.file}`);
    results.push({ ...shot, status: 'FAILED', reason: 'PNG になっていない' });
    return;
  }

  // 撮った現物がまだ SpringBoard なら、待機中に前面へ出たあと落ちた等の異常。
  const fp = await fingerprint(dest);
  if (distance(fp, springboard) <= SPRINGBOARD_DISTANCE) {
    console.error(`FAILED (SpringBoard を撮っている) for ${shot.file}`);
    results.push({ ...shot, status: 'FAILED', reason: 'アプリではなくホーム画面が写っている' });
    return;
  }

  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const size = `${w}x${h} ${Math.round(buf.length / 1024)}KB`;
  console.log(`captured: ${shot.file} (${size}) — ${shot.label}`);
  results.push({ ...shot, status: 'captured', size, fingerprint: fp });
}

/**
 * アプリが前面に出るまで待つ。URL 確認ダイアログで止まっている間は
 * 画面が SpringBoard のままなので、それを抜けたら成功とみなす。
 */
async function waitForForeground(springboard, shot) {
  const probe = path.join(tmpDir, 'probe.png');
  const deadline = Date.now() + args.dialogTimeoutMs;
  let hinted = false;
  while (Date.now() < deadline) {
    const cap = simctl(['io', udid, 'screenshot', '--type=png', probe]);
    if (cap.ok && fs.existsSync(probe)) {
      const d = distance(await fingerprint(probe), springboard);
      if (d > SPRINGBOARD_DISTANCE) return true;
    }
    if (!hinted) {
      hinted = true;
      console.log(
        `  待機中: ${shot.file} — シミュレータに「"さいえん手帳" で開きますか?」が出ていたら\n` +
          `  「開く」を押してください（iOS 17+ の仕様。最大 ${Math.round(args.dialogTimeoutMs / 1000)} 秒待ちます）`,
      );
    }
    await sleep(1000);
  }
  console.error(`FAILED (前面に出ない): ${shot.file}`);
  return false;
}

/** 同じ画面を 2 枚以上撮っていないか。撮り分けの失敗を最後に必ず検出する。 */
async function reportDuplicates() {
  const captured = results.filter((r) => r.status === 'captured' && r.fingerprint);
  for (let i = 0; i < captured.length; i += 1) {
    for (let j = i + 1; j < captured.length; j += 1) {
      if (distance(captured[i].fingerprint, captured[j].fingerprint) <= DUPLICATE_DISTANCE) {
        captured[i].status = 'FAILED';
        captured[j].status = 'FAILED';
        captured[i].reason = captured[j].reason =
          `同じ画面（${captured[i].file} と ${captured[j].file}）`;
        console.error(`FAILED: ${captured[i].file} と ${captured[j].file} が同じ画面です`);
      }
    }
  }
}

// ─── 画面の指紋 ───────────────────────────────────────────────────────────────

async function fingerprint(file) {
  const raw = await sharp(file).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer();
  return Uint8Array.from(raw);
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// ─── status bar override ─────────────────────────────────────────────────────

function overrideStatusBar() {
  // Apple 慣習の 9:41・電池満充電・電波/WiFi フルに固定する。
  simctl([
    'status_bar',
    udid,
    'override',
    '--time',
    '9:41',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
    '--wifiBars',
    '3',
    '--cellularBars',
    '4',
    '--dataNetwork',
    'wifi',
  ]);
}

function clearStatusBar() {
  simctl(['status_bar', udid, 'clear']);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function simctl(argv) {
  const res = spawnSync('xcrun', ['simctl', ...argv], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function autoSelectBootedUdid() {
  const res = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`xcrun simctl list に失敗: ${res.stderr ?? ''}`);
  let data;
  try {
    data = JSON.parse(res.stdout ?? '{}');
  } catch {
    throw new Error('simctl list の JSON 解析に失敗しました');
  }
  const booted = Object.values(data.devices ?? {})
    .flat()
    .filter((d) => d && d.state === 'Booted');
  if (booted.length !== 1) {
    throw new Error(
      booted.length === 0
        ? 'Boot 中のシミュレータがありません（例: xcrun simctl boot "iPhone 16 Pro Max"）'
        : `複数のシミュレータが Boot 中: ${booted.map((d) => d.udid).join(', ')} — --udid で指定してください`,
    );
  }
  return booted[0].udid;
}

function ensureAppInstalled() {
  const res = simctl(['get_app_container', udid, BUNDLE_ID]);
  if (!res.ok) {
    throw new Error(
      `${BUNDLE_ID} がシミュレータに未インストールです。サンプルデータ入りビルドを ` +
        `expo run:ios（Release）または xcrun simctl install で導入してください`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs(argv) {
  const parsed = { waitMs: 12000, keepStatusBar: false, dialogTimeoutMs: 90000 };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--udid') parsed.udid = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--planting') parsed.planting = argv[++i];
    else if (t === '--shots') parsed.shots = argv[++i].split(',').map((s) => s.trim());
    else if (t === '--wait') parsed.waitMs = Number(argv[++i]);
    else if (t === '--dialog-timeout') parsed.dialogTimeoutMs = Number(argv[++i]);
    else if (t === '--keep-status-bar') parsed.keepStatusBar = true;
  }
  return parsed;
}

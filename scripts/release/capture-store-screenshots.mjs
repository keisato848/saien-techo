/**
 * Google Play ストア掲載用スクリーンショットを接続中の端末/エミュレータから機械的に取得する。
 *
 * 仕組み: 各ショットごとに「アプリを force-stop → Expo Router のディープリンク
 * (saientecho://...) でコールドスタート → 待機 → adb exec-out screencap」。
 * ステータスバーは SystemUI デモモードで固定（時計 09:00・電池 100%・通知なし）。
 *
 * 前提:
 *   - ストアショット用リリース APK（サンプルデータ有効＋コーチマーク無効）がインストール済みであること:
 *       EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
 *         node scripts/agent/build-android.mjs --arch x86_64
 *       adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
 *   - 推奨エミュレータ: saien_e2e_api36（1080x2400 = Play 掲載のスマホ用スクショ解像度）
 *   - **`-wipe-data` で起こし直すとオンボーディング（地域選択）もやり直しになる。**
 *     未完了だとどのルートを開いても「ようこそ」画面が出る。通知の許可ダイアログも出る。
 *     **撮る前に人が「Allow」→「はじめる」を押すこと**（地域は既定の「中間地」のまま触らない）。
 *     シードを入れ直したいときは wipe-data が要る — 残高などの行は `onConflictDoNothing` で
 *     入るので、古い行が残っていると上書きされない
 *   - wipe-data 直後の初回ブートは SystemUI が重く ANR ダイアログが写り込むことがある。
 *     起動後 2〜3 分待ってから実行する（出たら Wait で閉じて再実行）
 *
 * 使い方:
 *   node scripts/release/capture-store-screenshots.mjs [--serial <serial>] [--shots 01,02]
 *     [--out <dir>] [--planting <id>] [--keep-status-bar]
 *
 * manual 指定のショット（AI 実行結果など自動遷移できない画面）はスキップし、
 * 既存ファイルを維持する。
 *
 * **撮れたかどうかはファイルサイズで分かる。** 中身が出ていれば 100KB 前後〜1MB、
 * **20KB 前後ならローディングのスピナーしか写っていない**（2026-08-22 に 8 枚全滅した）。
 * summary の KB を必ず見て、小さければ `--wait` を伸ばして撮り直す。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appIdentity } from '../agent/lib/app-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = path.join(ROOT, 'docs/store/google-play/phone-screenshots');
const { packageName: PACKAGE, scheme: SCHEME } = appIdentity();

const args = parseArgs(process.argv.slice(2));
/** サンプルデータの栽培 ID（src/db/seed.ts）。--planting で差し替えられる */
const PLANTING_ID = args.planting ?? 'planting-tomato-01';

/**
 * ショット定義。route は Expo Router のパス（saientecho://<route> で開く）。
 * manual: true は自動化不可（既存ファイル維持）。順序 = Play 表示順。
 *
 * **並びは「何のアプリか」→「どう使うか」→「何が返ってくるか」の順。**
 * 1 枚目で伝わらないと 2 枚目は見てもらえないので、ホームを先頭に置く。
 * Play のスマホ用スクショは最大 8 枚。
 *
 * だいどこ（レシピ蔵書庫・料理中モード・家族グループ）から WBS 3.8 で差し替えた。
 */
const SHOTS = [
  { file: '01-home.png', route: '', label: 'ホーム（今日の菜園）' },
  { file: '02-plantings.png', route: 'plantings', label: '栽培一覧' },
  {
    file: '03-planting-detail.png',
    route: `plantings/${PLANTING_ID}`,
    label: '栽培詳細（やった！を記録）',
  },
  { file: '04-harvests.png', route: 'harvests', label: '収穫アルバム' },
  { file: '05-crop-guide.png', route: 'crops', label: '作物ガイド' },
  { file: '06-calendar.png', route: 'calendar', label: 'カレンダー' },
  { file: '07-materials.png', route: 'materials', label: '資材の在庫' },
  // 1.1 の目玉（#148）。**シードが「読み取り済み 1・待ち 1」をこの用途で用意している**
  // （seed.ts の seedHarvestPhotoReads）ので、ルートを開くだけで撮れる。
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

const adbPath = resolveAdb();
const serial = args.serial ?? autoSelectSerial();
const outDir = args.out ? path.resolve(args.out) : DEFAULT_OUT;
fs.mkdirSync(outDir, { recursive: true });

console.log(`device: ${serial}`);
ensureAppInstalled();

const selected = SHOTS.filter(
  (s) => !args.shots || args.shots.some((prefix) => s.file.startsWith(prefix)),
);

if (!args.keepStatusBar) {
  enterDemoMode();
  sleep(3000); // デモモード反映待ち（ここで SystemUI が ANR することがある）
  dismissAnrIfPresent();
}
const results = [];
try {
  for (const shot of selected) {
    if (shot.manual) {
      console.log(`SKIP (manual): ${shot.file} — ${shot.label}`);
      results.push({ ...shot, status: 'manual-skip' });
      continue;
    }
    captureShot(shot);
  }
} finally {
  if (!args.keepStatusBar) exitDemoMode();
}

console.log('\n=== summary ===');
for (const r of results) {
  console.log(`${r.status.padEnd(12)} ${r.file}  ${r.size ?? ''}`);
}
const failed = results.filter((r) => r.status === 'FAILED');
process.exit(failed.length ? 1 : 0);

// ─── capture ─────────────────────────────────────────────────────────────────

function captureShot(shot) {
  const url = `${SCHEME}://${shot.route}`;
  adb(['shell', 'am', 'force-stop', PACKAGE]);
  const start = adb([
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    PACKAGE,
  ]);
  if (!start.ok) {
    console.error(`FAILED to open ${url}: ${start.output.slice(0, 200)}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  sleep(args.waitMs); // コールドスタート＋データ読込＋アニメーション静定
  dismissAnrIfPresent();

  const cap = spawnSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const png = cap.stdout;
  if (cap.status !== 0 || !png || png.length < 1000 || png.readUInt32BE(0) !== 0x89504e47) {
    console.error(`FAILED screencap for ${shot.file}`);
    results.push({ ...shot, status: 'FAILED' });
    return;
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  fs.writeFileSync(path.join(outDir, shot.file), png);
  const size = `${w}x${h} ${Math.round(png.length / 1024)}KB`;
  console.log(`captured: ${shot.file} (${size}) — ${shot.label}`);
  results.push({ ...shot, status: 'captured', size });
}

/**
 * wipe-data 直後の重いエミュレータではデモモードのブロードキャストで SystemUI が
 * ANR ダイアログを出し、スクショに写り込む。dumpsys でダイアログを検出し、
 * 「Wait」（実測で画面の x≈30% / y≈57% 位置）をタップして閉じる。
 */
function dismissAnrIfPresent() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const win = adb(['shell', 'dumpsys', 'window', 'windows']);
    if (!/Application Not Responding/.test(win.output)) return;
    if (attempt === 0) console.log('ANR dialog detected — dismissing (Wait)');
    const size = adb(['shell', 'wm', 'size']);
    const m = /(\d+)x(\d+)/.exec(size.output);
    const w = m ? Number(m[1]) : 1080;
    const h = m ? Number(m[2]) : 2400;
    adb(['shell', 'input', 'tap', String(Math.round(w * 0.3)), String(Math.round(h * 0.57))]);
    sleep(3000);
  }
  console.warn('WARN: ANR dialog may still be visible');
}

// ─── status bar demo mode ────────────────────────────────────────────────────

function enterDemoMode() {
  adb(['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1']);
  demo(['-e', 'command', 'enter']);
  demo(['-e', 'command', 'clock', '-e', 'hhmm', '0900']);
  demo(['-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false']);
  demo([
    '-e',
    'command',
    'network',
    '-e',
    'wifi',
    'show',
    '-e',
    'level',
    '4',
    '-e',
    'fully',
    'true',
  ]);
  demo(['-e', 'command', 'network', '-e', 'mobile', 'hide']);
  demo(['-e', 'command', 'notifications', '-e', 'visible', 'false']);
}

function exitDemoMode() {
  demo(['-e', 'command', 'exit']);
}

function demo(extras) {
  adb(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...extras]);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function adb(argv) {
  const res = spawnSync(adbPath, ['-s', serial, ...argv], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function resolveAdb() {
  const sdk =
    process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const exe = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (!fs.existsSync(exe)) throw new Error(`adb not found: ${exe}`);
  return exe;
}

function autoSelectSerial() {
  const res = spawnSync(adbPath, ['devices'], { encoding: 'utf8' });
  const devices = (res.stdout ?? '')
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0]);
  if (devices.length !== 1) {
    throw new Error(
      devices.length === 0
        ? 'デバイスが接続されていません（エミュレータ起動 or USB 接続）'
        : `複数デバイス接続中: ${devices.join(', ')} — --serial で指定してください`,
    );
  }
  return devices[0];
}

function ensureAppInstalled() {
  const res = adb(['shell', 'pm', 'path', PACKAGE]);
  if (!res.ok || !res.output.includes('package:')) {
    throw new Error(
      `${PACKAGE} が未インストールです。サンプルデータ入りビルドを install -r してください`,
    );
  }
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]);
}

function parseArgs(argv) {
  // 既定 7 秒では**ローディング中のスピナーが写る**（2026-08-22 に 8 枚全滅）。
  // サンプルデータの写真をコピーする初回起動や、負荷の高いマシンでは特に足りない。
  const parsed = { waitMs: 12000, keepStatusBar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--serial') parsed.serial = argv[++i];
    else if (t === '--out') parsed.out = argv[++i];
    else if (t === '--planting') parsed.planting = argv[++i];
    else if (t === '--shots') parsed.shots = argv[++i].split(',').map((s) => s.trim());
    else if (t === '--wait') parsed.waitMs = Number(argv[++i]);
    else if (t === '--keep-status-bar') parsed.keepStatusBar = true;
  }
  return parsed;
}

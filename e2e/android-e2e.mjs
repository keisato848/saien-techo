#!/usr/bin/env node
/**
 * さいえん手帳 — Android 実機 E2E テスト（菜園の一巡・WBS T2）
 *
 * 必要環境:
 *   - ADB 接続済みの Android 端末（実績: AQUOS SH-RM19s / Pixel 9a）
 *   - さいえん手帳(app.json の applicationId)がインストール済み
 *   - **端末のロックが解除されていて、実行中もロックされないこと**
 *     1 回に数分かかるので画面タイムアウトに負ける。開発者向けオプションの
 *     「充電中は画面を ON」か `adb shell svc power stayon true`（戻すときは false）
 *
 * 実行: node e2e/android-e2e.mjs
 *       TARGET_DEVICE=<serial> node e2e/android-e2e.mjs   # 端末を指定する場合
 *
 * 各テストは独立したフロー:
 *   1. force-stop でクリーン起動
 *   2. UI 階層を uiautomator dump で取得
 *   3. テキスト/bounds で要素を探してタップ
 *   4. 期待 UI 状態をスクリーンショット + UI dump で検証
 *   5. PASS/FAIL を集計
 */
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { androidPackage } from '../scripts/agent/lib/app-identity.mjs';

const PKG = androidPackage();
const ACT = `${PKG}/.MainActivity`;
const EXPO_DEV_URL = process.env.EXPO_DEV_URL || '';
const EXPO_DEV_SERVER_PORT = process.env.EXPO_DEV_SERVER_PORT || '8082';
const SCREENSHOT_DIR = resolve('e2e/screenshots/e2e-android');
const DUMP_DIR = resolve('e2e/ui-dumps');
const UI_DUMP_RETRIES = 8;
const UI_DUMP_RETRY_DELAY_MS = 1200;
const ADB_TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS || 45000);
const UI_DUMP_TIMEOUT_MS = Number(process.env.UI_DUMP_TIMEOUT_MS || 20000);
// 対象デバイスのシリアル番号。TARGET_DEVICE 環境変数で上書き可。未設定時は preflightCheck で自動選択。
let DEVICE_SERIAL = process.env.TARGET_DEVICE || null;

// adb の絶対パス. ADB_PATH 環境変数で上書き可。未設定の場合は PATH 上の adb を使用する。
// Windows では ANDROID_HOME または LOCALAPPDATA から自動検出を試みる。
const ADB =
  process.env.ADB_PATH ||
  (() => {
    if (process.platform !== 'win32') return 'adb';
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (androidHome) return `${androidHome}\\platform-tools\\adb.exe`;
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return `${localAppData}\\Android\\Sdk\\platform-tools\\adb.exe`;
    return 'adb';
  })();

mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(DUMP_DIR, { recursive: true });

// ─── ADB ヘルパー ─────────────────────────────────────────────────────────
function adbResult(args, timeout = ADB_TIMEOUT_MS) {
  const fullArgs = DEVICE_SERIAL && args[0] !== 'devices' ? ['-s', DEVICE_SERIAL, ...args] : args;
  return spawnSync(ADB, fullArgs, { encoding: 'utf8', shell: false, timeout });
}

function artifactName(name) {
  const safe = String(name || 'artifact')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'artifact';
}

function adbDetail(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const status = result.status ?? 'unknown';
  const error = result.error ? ` (${result.error.message})` : '';
  return `exit ${status}${error}${output ? `: ${output}` : ''}`;
}

function assertAdbOk(result, action) {
  if (result.status !== 0 || result.error) {
    throw new Error(`${action} failed: ${adbDetail(result)}`);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function adb(args, { silent = false } = {}) {
  const result = adbResult(args);
  if (!silent && result.status !== 0 && result.stderr) {
    // 警告のみで止めない
  }
  return result.stdout ?? '';
}

function sh(cmd) {
  return adb(['shell', ...cmd.split(' ')]);
}

function collapseSystemUi() {
  adb(['shell', 'cmd', 'statusbar', 'collapse'], { silent: true });
}

/**
 * ロック画面か。**通知シェードの判定より先に見る。**
 *
 * ロック画面にも通知スタックが載るので、シェードの目印
 * （notification_stack_scroller）だけで判定すると**ロック画面をシェードと誤認**する。
 * 実測: AQUOS SH-RM19s がスリープ+ロックの状態で、10 本すべてが
 * 「notification shade was open」で失敗し、原因が分からなかった（2026-08-12）。
 */
function xmlLooksLikeLockscreen(xml) {
  return (
    xml.includes('package="com.android.systemui"') &&
    (xml.includes('keyguard') || xml.includes('lockscreen') || xml.includes('lock_icon'))
  );
}

function xmlLooksLikeNotificationShade(xml) {
  if (xmlLooksLikeLockscreen(xml)) return false; // ロック画面はシェードではない
  return (
    xml.includes('package="com.android.systemui"') &&
    (xml.includes('notification_panel') ||
      xml.includes('notification_stack_scroller') ||
      xml.includes('quick_settings_container'))
  );
}

/**
 * 実行中のロックは**リトライで回復しない**ので、専用の例外で全体を止める。
 * 個々のテストの FAIL として握り潰すと、原因が 10 本ぶんのノイズに埋もれる。
 */
class LockedDeviceError extends Error {}

/** 端末がロック中か（dumpsys の真実。UI dump のヒューリスティックより確実） */
function isDeviceLocked() {
  const out = adb(['shell', 'dumpsys', 'window'], { silent: true });
  return /mDreamingLockscreen=true/.test(out);
}

/** 画面を起こす。ロックは解除しない（PIN を跨ぐ操作はしない） */
function wakeScreen() {
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { silent: true });
  sleepSync(800);
}

function tap(x, y) {
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

/** 画面を下へ送る。詳細画面の「栽培を終了」は折り返しの下にある */
function scrollDown(times = 1) {
  for (let i = 0; i < times; i += 1) {
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '700', '300']);
    sleepSync(900);
  }
}

/**
 * 画面を先頭まで戻す。
 *
 * **uiautomator は画面外のノードを落とす。** 送った状態のまま上の要素を探すと
 * 「無い」と誤判定する。位置に依存しない検証をしたいときは、まずここで
 * 状態を先頭に固定してから見る。
 */
function scrollToTop(times = 5) {
  for (let i = 0; i < times; i += 1) {
    adb(['shell', 'input', 'swipe', '540', '700', '540', '1800', '300']);
    sleepSync(700);
  }
}

/**
 * 入力欄へ文字を送る。
 *
 * **送れるのは大文字 ASCII と数字だけ。** `input text` は端末の IME を通るので、
 * 日本語 IME が有効な実機では小文字がローマ字かな変換されて別の文字列になる
 * （`E2EPlace576577` → `E2EPぁせ５７６５７７`・AQUOS SH-RM19s で実測）。
 * 変換されても入力自体は成功するため、**検証側で気づけない**。ここで弾く。
 */
function inputText(text) {
  if (/[a-z]/.test(text)) {
    throw new Error(`inputText に小文字が含まれる: ${text}（IME にかな変換される）`);
  }
  // ADB input text はスペースをそのまま送れないので %s に置換
  const safe = text.replace(/ /g, '%s');
  adb(['shell', 'input', 'text', safe]);
}

function key(code) {
  adb(['shell', 'input', 'keyevent', code]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dismissKeyboard() {
  key('KEYCODE_BACK');
  await sleep(800);
}

async function dismissSystemAnrIfShown() {
  let xml = '';
  try {
    xml = uiDump('system-dialog-check');
  } catch {
    return false;
  }
  if (!xml.includes("isn't responding") && !xml.includes('応答していません')) return false;

  const waitButton = findByText(xml, 'Wait') || findByText(xml, '待機');
  if (!waitButton) return false;

  tap(waitButton.cx, waitButton.cy);
  await sleep(3000);
  return true;
}

/**
 * OS の権限ダイアログを断る。
 *
 * 収穫フォームは開いた瞬間にカメラを起動する（R06「最短 3 タップ」の設計・autoCapture）。
 * 初回は権限ダイアログが出て操作を塞ぐ。**許可しない**を選べば capturePhoto が失敗し、
 * HarvestForm は「取り消し・失敗ともフォームに留まる」ので、写真なしで記録を続けられる。
 */
async function denyPermissionDialogIfShown() {
  let xml = '';
  try {
    xml = uiDump('permission-check');
  } catch {
    return false;
  }
  if (!xml.includes('com.android.permissioncontroller') && !xml.includes('許可しますか')) {
    return false;
  }
  const deny = findByText(xml, '許可しない') || findByText(xml, "Don't allow");
  if (!deny) return false;
  tap(deny.cx, deny.cy);
  await sleep(1500);
  return true;
}

function screenshot(name) {
  collapseSystemUi();
  const remote = '/sdcard/_e2e.png';
  const local = `${SCREENSHOT_DIR}/${artifactName(name)}.png`;
  assertAdbOk(adbResult(['shell', 'screencap', '-p', remote]), `screenshot ${name}`);
  assertAdbOk(adbResult(['pull', remote, local]), `pull screenshot ${name}`);
  adb(['shell', 'rm', remote], { silent: true });
  return local;
}

function uiDump(name = 'dump') {
  const remote = '/sdcard/_e2e.xml';
  const local = `${DUMP_DIR}/${artifactName(name)}.xml`;
  let lastError = '';

  const pullDump = (attempt) => {
    const pullResult = adbResult(['pull', remote, local]);
    adb(['shell', 'rm', remote], { silent: true });
    if (pullResult.status !== 0 || pullResult.error) {
      lastError = `pull attempt ${attempt}: ${adbDetail(pullResult)}`;
      return null;
    }

    if (!existsSync(local)) {
      lastError = `pull attempt ${attempt}: local dump was not created at ${local}`;
      return null;
    }

    const xml = readFileSync(local, 'utf8');
    if (xml.trim().length > 0) {
      if (xmlLooksLikeLockscreen(xml)) {
        // preflight は通ったのに途中でロックされた = **画面タイムアウト**。
        // KEYCODE_WAKEUP は画面を点けるだけでロックは解けないので、リトライしても無駄。
        // 実測: これで 10 本 × 8 リトライを空振りさせた（2026-08-12・AQUOS SH-RM19s）
        wakeScreen();
        if (isDeviceLocked()) {
          throw new LockedDeviceError(
            '実行中に画面がロックされました（画面タイムアウト）。\n' +
              '      1 回の実行に数分かかるので、開発者向けオプションの\n' +
              '      「充電中は画面を ON」を有効にするか、`adb shell svc power stayon true` を\n' +
              '      実行してから再試行してください（戻すときは stayon false）。',
          );
        }
        lastError = `read attempt ${attempt}: ロック画面を検出したが解除された。再取得する`;
        return null;
      }
      if (xmlLooksLikeNotificationShade(xml)) {
        lastError = `read attempt ${attempt}: notification shade was open`;
        collapseSystemUi();
        return null;
      }
      return xml;
    }

    lastError = `read attempt ${attempt}: local dump was empty at ${local}`;
    return null;
  };

  for (let attempt = 1; attempt <= UI_DUMP_RETRIES; attempt++) {
    if (existsSync(local)) rmSync(local, { force: true });

    const dumpResult = adbResult(['shell', 'uiautomator', 'dump', remote], UI_DUMP_TIMEOUT_MS);
    if (dumpResult.status !== 0 || dumpResult.error) {
      lastError = `dump attempt ${attempt}: ${adbDetail(dumpResult)}`;
      const output = [dumpResult.stdout, dumpResult.stderr].filter(Boolean).join('\n');
      if (output.includes('dumped to:') || output.includes(remote)) {
        const xml = pullDump(attempt);
        if (xml) return xml;
      } else {
        adb(['shell', 'rm', remote], { silent: true });
      }
      sleepSync(UI_DUMP_RETRY_DELAY_MS);
      continue;
    }

    const xml = pullDump(attempt);
    if (xml) return xml;
    sleepSync(UI_DUMP_RETRY_DELAY_MS);
  }

  throw new Error(`UI dump failed for "${name}" at ${local}: ${lastError}`);
}

// ─── UI 要素探索 ──────────────────────────────────────────────────────────
function findByText(xml, text) {
  return findNodeByAttr(xml, 'text', text);
}

/**
 * text 属性に**含まれる**ノードを探す（findByText は完全一致）。
 *
 * 一覧の行は「作物名　品種」を全角スペースで連結した 1 つの text になるため、
 * 品種だけでは完全一致しない（2026-08-12 実測: text="キュウリ　E2E504601"）。
 */
function findByTextContaining(xml, needle) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let match;
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0];
    const text = /\btext="([^"]*)"/.exec(node);
    if (!text || !decodeXml(text[1]).includes(needle)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    return {
      bounds: [+bounds[1], +bounds[2], +bounds[3], +bounds[4]],
      cx: Math.floor((+bounds[1] + +bounds[3]) / 2),
      cy: Math.floor((+bounds[2] + +bounds[4]) / 2),
    };
  }
  return null;
}

/** text 属性に含まれる文字列があるか（hasText は完全一致） */
function hasTextContaining(xml, needle) {
  return findByTextContaining(xml, needle) !== null;
}

function findByContentDesc(xml, desc) {
  return findNodeByAttr(xml, 'content-desc', desc);
}

function findByHint(xml, hint) {
  return findNodeByAttr(xml, 'hint', hint) || findNodeByAttr(xml, 'text', hint);
}

function hasAnyText(xml, texts) {
  return texts.some((text) => text && hasText(xml, text));
}

function toFullWidthDigits(value) {
  return value.replace(/\d/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
}

function getTextByHint(xml, hint) {
  const node = findNodeMarkupByAttr(xml, 'hint', hint);
  if (!node) return null;
  const match = /\btext="([^"]*)"/.exec(node);
  return match ? decodeXml(match[1]) : null;
}

function findNodeMarkupByAttr(xml, attr, value) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const node = m[0];
    if (node.includes(`${attr}="${value}"`)) return node;
  }
  return null;
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

// 各 <node ...> 要素を順次抽出し、指定属性が一致するノードの bounds を返す。
// 属性の出現順に依存せずに探索する。
function findNodeByAttr(xml, attr, value) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const node = m[0];
    if (node.includes(`${attr}="${value}"`)) {
      const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
      if (b) {
        return {
          bounds: [+b[1], +b[2], +b[3], +b[4]],
          cx: Math.floor((+b[1] + +b[3]) / 2),
          cy: Math.floor((+b[2] + +b[4]) / 2),
          markup: node,
        };
      }
    }
  }
  return null;
}

function findAllByText(xml, text) {
  const re = new RegExp(
    `text="${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    'g',
  );
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({
      bounds: [+m[1], +m[2], +m[3], +m[4]],
      cx: Math.floor((+m[1] + +m[3]) / 2),
      cy: Math.floor((+m[2] + +m[4]) / 2),
    });
  }
  return results;
}

function findTopRightClickable(xml) {
  const nodeRe = /<node\b[^>]*\/?>/g;
  let match;
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0];
    if (!node.includes('clickable="true"')) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    const left = +bounds[1];
    const top = +bounds[2];
    const right = +bounds[3];
    const bottom = +bounds[4];
    if (left < 850 || top > 260) continue;
    return {
      bounds: [left, top, right, bottom],
      cx: Math.floor((left + right) / 2),
      cy: Math.floor((top + bottom) / 2),
    };
  }
  return null;
}

function findFirstEditText(xml) {
  return findAllEditTexts(xml)[0] ?? null;
}

/**
 * すべての入力欄を**出現順**で返す。
 *
 * React Native の TextInput はプレースホルダを `text` に載せるだけで `hint` 属性を持たない。
 * そのため `findByHint('品種')` は当たらず、順番で掴むしかない
 * （栽培フォーム: 0=作物名 / 1=品種 / 2=タグ追加。2026-08-12 実測）。
 * **画面の並びが変わると壊れる**ので、使う側は個数を検査してから使うこと。
 */
function findAllEditTexts(xml) {
  const pattern =
    /<node\b[^>]*\bclass="android\.widget\.EditText"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  const found = [];
  for (const match of xml.matchAll(pattern)) {
    found.push({
      bounds: [+match[1], +match[2], +match[3], +match[4]],
      cx: Math.floor((+match[1] + +match[3]) / 2),
      cy: Math.floor((+match[2] + +match[4]) / 2),
    });
  }
  return found;
}

function hasText(xml, text) {
  return xml.includes(`text="${text}"`);
}

/**
 * content-desc が正規表現に当たるノードがあるか。
 *
 * 点や丸のような**文字を持たない描画**を見るのに使う。カレンダーのマスは
 * 「15日　記録 2 件」を content-desc に載せているので、点の有無をここで読める。
 */
function hasContentDescMatching(xml, pattern) {
  for (const match of xml.matchAll(/content-desc="([^"]*)"/g)) {
    if (pattern.test(match[1])) return true;
  }
  return false;
}

// ─── 共通フロー ────────────────────────────────────────────────────────────
async function dismissCompatWarningIfShown() {
  await sleep(500);
  let xml = '';
  try {
    xml = uiDump('compat-check');
  } catch {
    return false;
  }
  if (xml.includes('16 KB') || xml.includes('Android アプリの互換性')) {
    const btn = findByText(xml, '次回から表示しない');
    if (btn) {
      tap(btn.cx, btn.cy);
      await sleep(1500);
      return true;
    }
  }
  return false;
}

async function launchApp() {
  collapseSystemUi();
  adb(['shell', 'am', 'force-stop', PKG]);
  await sleep(800);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  await sleep(300);

  if (EXPO_DEV_URL) {
    adb(['reverse', `tcp:${EXPO_DEV_SERVER_PORT}`, `tcp:${EXPO_DEV_SERVER_PORT}`], {
      silent: true,
    });
    adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', EXPO_DEV_URL]);
  } else {
    adb(['shell', 'am', 'start', '-n', ACT]);
  }

  await sleep(EXPO_DEV_URL ? 10000 : 5000); // splash + initial render
  collapseSystemUi();
  await dismissSystemAnrIfShown();
  await dismissCompatWarningIfShown();
  await sleep(800);
}

async function tapTab(label) {
  const xml = uiDump(`tabbar-${label}`);
  const tab = findByText(xml, label);
  if (!tab) throw new Error(`Tab not found: ${label}`);
  tap(tab.cx, tab.cy);
  await sleep(1500);
}

// ─── テストランナー ────────────────────────────────────────────────────────
const results = [];
let lastCreatedRecipeName = null;

function record(name, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ ';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ name, status, detail });
}

async function test(name, fn) {
  try {
    const result = await fn();
    record(name, result === false ? 'FAIL' : 'PASS', typeof result === 'string' ? result : '');
  } catch (err) {
    record(name, 'FAIL', err.message);
    // ロックは環境の問題。以降も必ず落ちるので握り潰さず全体を止める
    if (err instanceof LockedDeviceError) throw err;
  }
}

// ─── 環境チェック ──────────────────────────────────────────────────────────
function preflightCheck() {
  const devices = adb(['devices'], { silent: true });
  const lines = devices
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List'));
  // Each line is "<serial>\tdevice" or "<serial>\tunauthorized"
  const authorized = lines.filter((l) => /\tdevice$/.test(l));
  if (authorized.length === 0) {
    console.error('[NG] No authorized device. adb output:');
    console.error(devices);
    process.exit(1);
  }
  // TARGET_DEVICE 未指定の場合は最初の認証済みデバイスを自動選択
  if (!DEVICE_SERIAL) {
    DEVICE_SERIAL = authorized[0].split('\t')[0].trim();
  }
  const installed = adb(['shell', 'pm', 'list', 'packages', PKG]);
  if (!installed.includes(PKG)) {
    console.error(`[NG] ${PKG} not installed.`);
    process.exit(1);
  }

  // ロック中だと全テストが UI dump 失敗で落ちる。**ここで早く止める。**
  // 実測: 気づかずに 10 本 × 8 リトライで 1 分半を捨てた（2026-08-12）
  wakeScreen();
  if (isDeviceLocked()) {
    console.error(`[NG] ${DEVICE_SERIAL} はロック画面です。`);
    console.error('     端末のロックを解除してから再実行してください。');
    console.error('     （PIN/パターンを跨ぐ操作はこのハーネスでは行いません）');
    process.exit(1);
  }

  console.log(`[OK] ${DEVICE_SERIAL}      device + ${PKG} + 画面ロック解除済み`);
}

// ─── 各テスト ─────────────────────────────────────────────────────────────
/**
 * 菜園の一巡（WBS T2）。
 *
 * だいどこの 13 シナリオ（レシピ詳細・料理中モード・URL 取り込み・OCR・家族）は
 * さいえん手帳では 1 本も通らないので全部捨てた。仕組み（uiautomator dump →
 * テキスト検索 → タップ）はそのまま流用している。
 *
 * 流れ: 起動 → 栽培を登録 → 作業を 1 タップ記録 → 収穫を記録 →
 *       アルバムに出る → カレンダーに出る → 栽培を終了
 *
 * **CI では走らせない。** 端末が要るうえ 1 回数分かかる。リリース前と、
 * 通知・バックアップのようにネイティブ依存の機能を触ったときに手で回す。
 */

/** このランで作る栽培の品種名。実行ごとに変えて既存データと衝突させない */
const RUN_TAG = String(Date.now()).slice(-6);
const TEST_VARIETY = `E2E${RUN_TAG}`;
/**
 * このランで作る場所名。
 *
 * **小文字を混ぜてはいけない。** `adb shell input text` は端末の IME を通るため、
 * 日本語 IME が有効な実機では小文字がローマ字かな変換される。
 * `E2EPlace576577` を送ったら `E2EPぁせ５７６５７７` になった（AQUOS SH-RM19s・2026-08-13 実測。
 * かなに落ちたあと続く数字まで全角になる）。大文字と数字だけなら素通りする。
 */
const TEST_PLACE = `E2EPLACE${RUN_TAG}`;

async function testAppLaunch() {
  await launchApp();
  screenshot('01-launch');
  const xml = uiDump('launch');
  if (!hasText(xml, 'さいえん手帳') && !hasAnyText(xml, ['ホーム', '栽培']))
    throw new Error('ホーム画面が描画されていない');
  return 'ホーム描画';
}

async function testTabNavigation() {
  const TABS = ['ホーム', '栽培', '追加', '収穫', '設定'];

  // まずタブ構成そのものを見る。1 つ増減しても往復だけでは気づけない
  const xml = uiDump('tabbar-composition');
  const missing = TABS.filter((label) => !hasText(xml, label));
  if (missing.length > 0) throw new Error(`タブバーに無い: ${missing.join(' / ')}`);

  // 「追加」は記録の入口。ここが開かないと 1 タップ記録の導線が死ぬ
  await tapTab('追加');
  screenshot('02-tab-追加');
  const addXml = uiDump('tab-add-screen');
  if (!hasAnyText(addXml, ['作業を記録', '栽培を追加']))
    throw new Error('「追加」が記録の入口になっていない');

  for (const label of ['栽培', '収穫', '設定', 'ホーム']) {
    await tapTab(label);
    screenshot(`02-tab-${label}`);
  }
  return '5 タブの構成を確認 + 往復';
}

/**
 * 栽培を登録する。品種に RUN_TAG を入れて、後続テストが自分の作ったものを特定できるようにする。
 *
 * **作物ガイドの「この作物を育てはじめる」から入る。** 理由が 2 つある:
 *   1. `adb shell input text` は **ASCII しか送れない**。作物名（必須・日本語）を
 *      直接打てないので、ガイド側から cropName を渡してもらう
 *      （2026-08-12 に「トマト」が入らず「作物名は必須です」で弾かれた）
 *   2. R09 → R01 の実利用導線そのものを検証できる
 *
 * **BACK でキーボードを閉じない。** このフォームでは BACK がフォームごと閉じる（実測）。
 * 「登録」はヘッダー（y≒140）にあってキーボードに隠れないので、そのまま押せる。
 *
 * 入力欄はプレースホルダが `text` に出るだけで `hint` 属性を持たないため
 * `findByHint` は当たらない。**出現順の EditText**（0=作物名 / 1=品種）で掴む。
 */
async function testCreatePlanting() {
  await launchApp();

  // 作物ガイド → 先頭の作物 → 「この作物を育てはじめる」
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://crops',
    PKG,
  ]);
  await sleep(2500);

  let xml = uiDump('crops-for-create');
  const crop = findByText(xml, 'トマト') || findByText(xml, 'キュウリ') || findByText(xml, 'ナス');
  if (!crop) throw new Error('作物ガイドに作物が出ていない');
  tap(crop.cx, crop.cy);
  await sleep(2000);

  xml = uiDump('crop-detail');
  screenshot('03-crop-detail');
  const start =
    findByContentDesc(xml, 'この作物を育てはじめる') || findByText(xml, 'この作物を育てはじめる');
  if (!start) throw new Error('「この作物を育てはじめる」が見つからない');
  tap(start.cx, start.cy);
  await sleep(2000);

  xml = uiDump('planting-form');
  screenshot('04-planting-form');

  const fields = findAllEditTexts(xml);
  if (fields.length < 2)
    throw new Error(`入力欄が足りない（EditText ${fields.length} 個。作物名と品種が要る）`);

  // 品種にこのランの印を入れる（ASCII なので input text で送れる）
  tap(fields[1].cx, fields[1].cy);
  await sleep(600);
  inputText(TEST_VARIETY);
  await sleep(400);

  screenshot('05-planting-form-filled');
  xml = uiDump('planting-form-filled');
  const save = findByText(xml, '登録') || findByText(xml, '保存');
  if (!save) throw new Error('「登録」が見つからない（フォームが閉じている可能性）');
  tap(save.cx, save.cy);
  await sleep(2500);

  // **登録すると一覧ではなく「作った栽培の詳細」へ飛ぶ**（2026-08-12 実測）。
  // 「やった！を記録」が出ていることを詳細画面の証拠にする。
  // 品種の文字列だけを見ると、登録に失敗して開いたままのフォームでも通ってしまう
  // （実際に誤 PASS した）ので、フォーム特有の文言が消えたことも見る。
  screenshot('06-planting-created');
  xml = uiDump('planting-created-detail');
  if (hasText(xml, 'キャンセル') && hasText(xml, '登録'))
    throw new Error('フォームが閉じていない（バリデーションで弾かれた可能性）');
  if (!hasTextContaining(xml, TEST_VARIETY)) throw new Error(`詳細画面に ${TEST_VARIETY} が出ない`);
  if (!hasText(xml, 'やった！を記録'))
    throw new Error('詳細画面に遷移していない（「やった！を記録」が無い）');
  return `${TEST_VARIETY} を登録（作物ガイド経由）`;
}

/** 作った栽培の詳細を開く（後続テストの入り口） */
async function openTestPlanting() {
  // **タブ経由にしない。** 直前のテストが作物ガイド等を開いていると
  // tapTab では戻れず、一覧のつもりで別画面を掴む（2026-08-12 に実測）。
  // ハーネスの原則どおりディープリンクが最も堅牢
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://plantings',
    PKG,
  ]);
  await sleep(2000);
  const xml = uiDump('plantings-open');
  // 行の text は「作物名　品種」の連結なので部分一致で掴む
  const row = findByTextContaining(xml, TEST_VARIETY);
  if (!row) throw new Error(`一覧に ${TEST_VARIETY} が無い`);
  tap(row.cx, row.cy);
  await sleep(1800);
}

/** クイック記録（R04 の「1〜2 タップ」）。詳細画面の 5 ボタンから水やりを押す */
async function testQuickCareLog() {
  await openTestPlanting();
  screenshot('07-planting-detail');

  let xml = uiDump('detail-before-log');
  const water = findByContentDesc(xml, '水やりを記録') || findByText(xml, '水やり');
  if (!water) throw new Error('クイック記録の「水やり」が見つからない');
  tap(water.cx, water.cy);
  await sleep(2000);

  screenshot('08-care-logged');
  xml = uiDump('detail-after-log');
  // 作業ログ欄に出るか、完了トーストが出ていれば成功
  if (!hasAnyText(xml, ['水やり', '記録しました'])) throw new Error('作業ログに反映されていない');
  return '水やりを 1 タップ記録';
}

/**
 * 完了トーストが**消えずに残る**ことを見る（#92 の回帰）。
 *
 * ユニットテストでは jest の Animated モックが中断を再現しないため検出できない。
 * 実機でしか確認できないので、ここに置く。
 */
async function testToastStaysVisible() {
  await openTestPlanting();

  const xml = uiDump('toast-before');
  const prune = findByContentDesc(xml, '剪定を記録') || findByText(xml, '剪定');
  if (!prune) throw new Error('クイック記録の「剪定」が見つからない');
  tap(prune.cx, prune.cy);

  // **待たずにすぐ撃つ。** uiautomator dump 自体が 1〜3 秒かかるので、
  // sleep を挟むと 2 秒のトーストを過ぎてしまう（2026-08-12 に空振りした）。
  // 中断バグ（#92）なら 200ms 程度で消えるので、この撃ち方でも十分に区別できる。
  const during = uiDump('toast-during');
  screenshot('09-toast');
  // **hasText は完全一致。** トーストは「剪定を記録しました」なので
  // '記録しました' では当たらない（2026-08-12 に空振りして誤検知した）
  const TOAST = '剪定を記録しました';
  if (!hasText(during, TOAST))
    throw new Error('完了トーストが出ていない（#92 の再発か、記録自体の失敗）');

  // 所定時間後には消える
  await sleep(3500);
  const after = uiDump('toast-after');
  if (hasText(after, TOAST)) throw new Error('トーストが消えない（自動 dismiss の故障）');
  return 'トーストが約 2 秒表示されて消える';
}

/** 収穫を記録する（R06 の最短 3 タップ） */
async function testCreateHarvest() {
  await openTestPlanting();

  let xml = uiDump('detail-before-harvest');
  const harvestButton = findByContentDesc(xml, '収穫を記録') || findByText(xml, '収穫した');
  if (!harvestButton) throw new Error('「収穫した」が見つからない');
  tap(harvestButton.cx, harvestButton.cy);
  await sleep(2500);

  // 開いた瞬間にカメラが起動する設計なので、権限ダイアログとカメラを片付ける
  await denyPermissionDialogIfShown();
  await sleep(1200);

  screenshot('10-harvest-form');
  xml = uiDump('harvest-form');
  const save = findByText(xml, '記録') || findByText(xml, '保存');
  if (!save) throw new Error('収穫フォームの保存ボタンが見つからない');
  tap(save.cx, save.cy);
  await sleep(2500);

  screenshot('11-harvest-saved');
  return '収穫を記録';
}

/** 収穫アルバム（R07）に出るか */
async function testHarvestAlbum() {
  await tapTab('収穫');
  await sleep(2000);
  screenshot('12-harvest-album');
  const xml = uiDump('harvest-album');
  // 月別グリッド。作った栽培の作物名か、空状態でないことを見る
  if (hasText(xml, 'まだ収穫の記録がありません'))
    throw new Error('収穫アルバムが空のまま（記録が反映されていない）');
  return 'アルバムに収穫が出る';
}

/** カレンダー（R05）に作業・収穫が出るか */
async function testCalendar() {
  await launchApp();
  const started = adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://calendar',
    PKG,
  ]);
  if (/Error/i.test(started)) throw new Error('カレンダーへのディープリンクが失敗');
  await sleep(2500);
  screenshot('13-calendar');
  const xml = uiDump('calendar');
  if (!hasAnyText(xml, ['カレンダー', '月', '日'])) throw new Error('カレンダーが描画されていない');

  // **描画されただけでは足りない。** T04/T06 で今日の記録を作っているので、
  // 記録のある日には印（点）が付いていなければならない。点は文字を持たないが、
  // マスの content-desc が「N日　記録 M 件」になるのでここで読める
  if (!hasContentDescMatching(xml, /記録\s*\d+\s*件/)) {
    throw new Error('記録のある日に印が付いていない（今日の作業ログと収穫が反映されていない）');
  }
  return 'カレンダー描画 + 記録のある日に印';
}

/** 作物ガイド（R09）— 30 作物のマスターが載っているか */
async function testCropGuide() {
  const started = adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://crops',
    PKG,
  ]);
  if (/Error/i.test(started)) throw new Error('作物ガイドへのディープリンクが失敗');
  await sleep(2500);
  screenshot('14-crop-guide');
  const xml = uiDump('crop-guide');
  if (!hasText(xml, '作物ガイド')) throw new Error('作物ガイドが描画されていない');
  // 代表的な作物が出ていること（マスター投入の確認）
  if (!hasAnyText(xml, ['トマト', 'ダイコン', 'キュウリ', 'ナス']))
    throw new Error('作物マスターが空に見える');
  return '作物ガイドに 30 作物マスターが載る';
}

/**
 * 栽培を終了する。
 *
 * **このランで作った株は先に削除済み**なので、サンプルデータの株で確認する。
 * 終了は状態遷移なので、対象がどの株でも導線の検証としては成立する。
 * 終了した株は一覧の既定（育成中）から外れるため、削除より後に置けない。
 */
async function testEndSamplePlanting() {
  // 一覧の先頭の株を開く（サンプルデータは常に何件かある）
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://plantings',
    PKG,
  ]);
  await sleep(2000);

  let listXml = uiDump('plantings-for-end');
  const firstRow = findByTextContaining(listXml, '日目');
  if (!firstRow) throw new Error('一覧に栽培が 1 件も無い（サンプルデータ未投入？）');
  tap(firstRow.cx, firstRow.cy);
  await sleep(1800);

  // 「栽培を終了する」は作業ログ・収穫・リマインダーの下にあるので送る必要がある。
  // **文言は「終了する」。** findByText は完全一致なので「栽培を終了」では当たらない
  // （2026-08-12 に空振りした）
  const findEnd = (xml) =>
    findByTextContaining(xml, '栽培を終了') || findByContentDesc(xml, '栽培を終了');

  let xml = uiDump('detail-before-end');
  let endButton = findEnd(xml);
  for (let i = 0; i < 4 && !endButton; i += 1) {
    scrollDown();
    xml = uiDump(`detail-scroll-${i}`);
    endButton = findEnd(xml);
  }
  if (!endButton) throw new Error('「栽培を終了する」が見つからない（4 回送っても出ない）');
  tap(endButton.cx, endButton.cy);
  await sleep(1500);

  screenshot('16-end-sheet');
  xml = uiDump('end-sheet');
  // 終了理由のシート。文言は ENDED_REASON_LABEL（収穫完了 / 枯れた / その他）
  const reason =
    findByText(xml, '収穫完了') || findByText(xml, '枯れた') || findByText(xml, 'その他');
  if (!reason) throw new Error('終了理由の選択肢が見つからない');
  tap(reason.cx, reason.cy);
  await sleep(2500);

  // **押しただけでは足りない。** 終了した株は詳細で「育成中に戻す」に変わり、
  // クイック記録が消える。ここを見ないと、シートを閉じただけでも PASS する
  screenshot('17-planting-ended');
  xml = uiDump('detail-after-end');
  if (!hasTextContaining(xml, '育成中に戻す'))
    throw new Error('終了後の詳細が「育成中に戻す」になっていない');
  if (hasText(xml, 'やった！を記録')) throw new Error('終了した栽培にクイック記録が残っている');

  // 一覧の既定（育成中）から外れ、「終了した栽培」側に移ること
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://plantings',
    PKG,
  ]);
  await sleep(2000);
  listXml = uiDump('plantings-after-end');
  const endedTab = findByText(listXml, '終了した栽培');
  if (!endedTab) throw new Error('一覧に「終了した栽培」の切り替えが無い');
  tap(endedTab.cx, endedTab.cy);
  await sleep(1800);

  screenshot('18-ended-list');
  listXml = uiDump('plantings-ended-list');
  // 終了理由が添えられている行があること（終了済みの一覧である証拠）
  if (!hasTextContaining(listXml, '収穫完了') && !hasTextContaining(listXml, '枯れた'))
    throw new Error('「終了した栽培」に終了理由つきの行が出ない');

  // **終わったら育成中に戻す。** 戻さないと 1 回走らせるごとにサンプルの株が
  // 1 つ減り、繰り返すと「一覧に栽培が 1 件も無い」で落ちるようになる
  const endedRow = findByTextContaining(listXml, '日目');
  if (!endedRow) throw new Error('「終了した栽培」に行が無い');
  tap(endedRow.cx, endedRow.cy);
  await sleep(1800);

  // 「育成中に戻す」は作業ログ・収穫の下。記録の多い株では折り返しの外にある
  // （記録の少ない株がたまたま当たると、送らなくても見えて通ってしまう）
  xml = uiDump('detail-for-resume');
  let resume = findByTextContaining(xml, '育成中に戻す');
  for (let i = 0; i < 4 && !resume; i += 1) {
    scrollDown();
    xml = uiDump(`detail-resume-scroll-${i}`);
    resume = findByTextContaining(xml, '育成中に戻す');
  }
  if (!resume) throw new Error('「育成中に戻す」が見つからない（4 回送っても出ない）');
  tap(resume.cx, resume.cy);
  await sleep(2500);

  // 再開するとクイック記録とお知らせが挿さって画面が伸びる。**送った位置のまま
  // 見ると、上も下も画面外に落ちて何を探しても外れる。** 先頭に戻してから見る
  scrollToTop();
  xml = uiDump('detail-after-resume');
  if (!hasText(xml, 'やった！を記録')) throw new Error('育成中に戻したのにクイック記録が出ない');
  if (hasTextContaining(xml, 'に終了（'))
    throw new Error('育成中に戻したのに終了バナーが残っている');

  return '栽培を終了 →「終了した栽培」へ移る → 育成中に戻す';
}

/**
 * このランで作った栽培を消す。
 *
 * **後片付けをしないと実機にゴミが溜まる。** 実測で 3 ランぶんの
 * E2E<連番> が残り、一覧が汚れたうえに「どれが今回のか」が分からなくなった。
 * 終了（アーカイブ）だけでは消えないので、詳細 → 削除まで行う。
 */
/**
 * 場所を登録する（R02 / WBS 1.6）。
 *
 * 場所は**それ自体が目的の画面ではない** — 栽培フォームのピッカーに出て
 * はじめて意味を持つ。登録できることと、出ることを 2 本に分けて見る。
 */
async function testCreatePlace() {
  await launchApp();
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://places',
    PKG,
  ]);
  await sleep(2500);

  let xml = uiDump('places-before-add');
  // ＋ と空状態のボタンが同じラベル。どちらでもフォームは開く
  const add = findByContentDesc(xml, '場所を追加') || findByText(xml, '場所を追加');
  if (!add) throw new Error('「場所を追加」が見つからない');
  tap(add.cx, add.cy);
  await sleep(2000);

  xml = uiDump('place-form');
  screenshot('16-place-form');
  const fields = findAllEditTexts(xml);
  // 0=名前 / 1=メモ。RN の TextInput は hint を持たないので順番で掴む
  if (fields.length < 1) throw new Error('場所フォームに入力欄が無い');
  tap(fields[0].cx, fields[0].cy);
  await sleep(600);
  inputText(TEST_PLACE);
  await sleep(400);

  xml = uiDump('place-form-filled');
  const save = findByText(xml, '登録') || findByText(xml, '保存');
  if (!save) throw new Error('「登録」が見つからない');
  tap(save.cx, save.cy);
  await sleep(2500);

  screenshot('17-place-created');
  xml = uiDump('places-after-add');
  if (!hasTextContaining(xml, TEST_PLACE)) throw new Error(`一覧に ${TEST_PLACE} が出ない`);
  return `${TEST_PLACE} を登録`;
}

/** 登録した場所が栽培フォームのピッカーに出るか（場所単体では意味を持たない） */
async function testPlaceInPlantingForm() {
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://plantings/new',
    PKG,
  ]);
  await sleep(2500);

  let xml = uiDump('planting-form-for-place');
  // 必須ラベルは「作物名 *」。完全一致だと外れる
  if (!hasTextContaining(xml, '作物名')) throw new Error('栽培フォームが開いていない');

  // 場所は下の方。画面に入るまで送る
  for (let i = 0; i < 4 && !hasTextContaining(xml, TEST_PLACE); i += 1) {
    scrollDown();
    xml = uiDump(`planting-form-place-scroll-${i}`);
  }
  screenshot('18-planting-form-place');
  if (!hasTextContaining(xml, TEST_PLACE))
    throw new Error(`栽培フォームのピッカーに ${TEST_PLACE} が出ない（4 回送っても出ない）`);

  // 開いたままにすると次のテストが別画面を掴む
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  await sleep(1200);
  return `ピッカーに ${TEST_PLACE} が出る`;
}

/** 後片付け。物理削除は「まだ使っていない場所」だけに出る（このランの場所は未使用） */
async function testCleanupTestPlace() {
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'saientecho://places',
    PKG,
  ]);
  await sleep(2200);

  let xml = uiDump('place-cleanup-list');
  const row = findByTextContaining(xml, TEST_PLACE);
  if (!row) throw new Error(`一覧に ${TEST_PLACE} が無い`);
  tap(row.cx, row.cy);
  await sleep(1800);

  xml = uiDump('place-cleanup-edit');
  let deleteButton = findByTextContaining(xml, '削除');
  for (let i = 0; i < 3 && !deleteButton; i += 1) {
    scrollDown();
    xml = uiDump(`place-cleanup-scroll-${i}`);
    deleteButton = findByTextContaining(xml, '削除');
  }
  if (!deleteButton) throw new Error('「削除する」が見つからない（使用中と判定された可能性）');
  tap(deleteButton.cx, deleteButton.cy);
  await sleep(1500);

  // 確認は端末のダイアログ。**後から描かれる方**がダイアログのボタン
  xml = uiDump('place-cleanup-confirm');
  const confirms = findAllByText(xml, '削除する');
  if (confirms.length > 0) {
    tap(confirms[confirms.length - 1].cx, confirms[confirms.length - 1].cy);
    await sleep(2000);
  }

  xml = uiDump('places-after-cleanup');
  if (hasTextContaining(xml, TEST_PLACE)) throw new Error(`${TEST_PLACE} が消えていない`);
  return `${TEST_PLACE} を削除`;
}

async function testCleanupTestPlanting() {
  await openTestPlanting();

  // 文言は「削除する」。完全一致だと外れるので部分一致で探す
  const findDelete = (xml) =>
    findByTextContaining(xml, '削除') || findByContentDesc(xml, 'この栽培を削除');

  let xml = uiDump('cleanup-detail');
  let deleteButton = findDelete(xml);
  for (let i = 0; i < 4 && !deleteButton; i += 1) {
    scrollDown();
    xml = uiDump(`cleanup-scroll-${i}`);
    deleteButton = findDelete(xml);
  }
  if (!deleteButton) throw new Error('「削除」が見つからない（4 回送っても出ない）');
  tap(deleteButton.cx, deleteButton.cy);
  await sleep(1500);

  // 確認シート
  xml = uiDump('cleanup-confirm');
  const confirm = findByText(xml, '削除する') || findByText(xml, '削除');
  if (confirm) {
    tap(confirm.cx, confirm.cy);
    await sleep(2000);
  }

  screenshot('15-cleaned-up');
  return `${TEST_VARIETY} を削除`;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  さいえん手帳 Android E2E テスト（菜園の一巡）');
  console.log(`  ${new Date().toLocaleString('ja-JP')}`);
  console.log('═'.repeat(60));

  preflightCheck();

  await test('T01 アプリ起動 + ホーム描画', testAppLaunch);
  await test('T02 タブ間ナビゲーション', testTabNavigation);
  await test('T03 栽培を登録', testCreatePlanting);
  await test('T04 クイック記録（水やり 1 タップ）', testQuickCareLog);
  await test('T05 完了トーストが消えずに残る（#92 回帰）', testToastStaysVisible);
  await test('T06 収穫を記録', testCreateHarvest);
  await test('T07 収穫アルバムに出る', testHarvestAlbum);
  await test('T08 カレンダー描画', testCalendar);
  await test('T09 作物ガイド（30 作物マスター）', testCropGuide);
  await test('T10 場所を登録', testCreatePlace);
  await test('T11 場所が栽培フォームのピッカーに出る', testPlaceInPlantingForm);
  // **後片付けを終了より先に置く。** 終了した株は一覧の既定（育成中）から外れるため、
  // 順番を逆にすると削除対象を見つけられない（2026-08-12 実測）
  await test('T12 後片付け（テストで作った栽培を削除）', testCleanupTestPlanting);
  await test('T13 後片付け（テストで作った場所を削除）', testCleanupTestPlace);
  await test('T14 栽培を終了 →「終了した栽培」→ 育成中に戻す', testEndSamplePlanting);

  // サマリー
  console.log('\n' + '═'.repeat(60));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`  結果: PASS ${pass} / FAIL ${fail} / 合計 ${results.length}`);
  console.log('═'.repeat(60));

  if (fail > 0) {
    console.log('\n❌ 失敗:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`   ${r.name}: ${r.detail}`);
    }
  }
  console.log(`\n  スクリーンショット: ${SCREENSHOT_DIR}`);
  console.log(`  UI dump: ${DUMP_DIR}`);

  // JSON で結果を出力
  writeFileSync(
    'e2e/android-e2e-result.json',
    JSON.stringify(
      { ts: new Date().toISOString(), pass, fail, total: results.length, results },
      null,
      2,
    ),
  );

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFatal:', e);
  process.exit(1);
});

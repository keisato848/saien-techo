#!/usr/bin/env node
/**
 * E2E の実行で崩れた端末のデータをシード状態へ戻す（`pnpm agent:android:e2e:restore`）。
 *
 * ## なぜ要るか
 *
 * `android-e2e.mjs` は自分で後片付けするが、**途中で落ちるとそこで止まる**。
 * 作った栽培・場所が残り、終了させたサンプル株が終了したままになる。
 * 放っておくと育成中の株が減り、最後は「一覧に栽培が 1 件も無い」で
 * 起動直後から落ちるようになる。同じ後片付けを 3 回書いたので常設にした。
 *
 * ## 戻す先
 *
 * シードの初期状態: トマト アイコ / キュウリ / アオジソ = 育成中、
 * バジル = 終了（収穫完了）。E2E の印（`E2E...`）が付いた栽培・場所は残骸なので消す。
 *
 * **サンプルデータを入れたビルドが前提。** 実利用者の端末では動かさないこと
 * （育成中に戻す対象を作物名で選ぶため、同名の実データを触る）。
 */
import { spawnSync } from 'child_process';

const ADB = `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;
const PKG = 'com.saientecho.app';
/** 育成中に戻すべき株（バジルはシードでも終了済みなので触らない） */
const SHOULD_BE_GROWING = ['トマト', 'キュウリ', 'アオジソ'];

const adb = (args) => spawnSync(ADB, args, { encoding: 'utf8', timeout: 45000 }).stdout ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (x, y) => adb(['shell', 'input', 'tap', String(x), String(y)]);

function dump() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_r.xml']);
  return adb(['shell', 'cat', '/sdcard/_r.xml']);
}

function nodesContaining(xml, needle) {
  const out = [];
  for (const m of xml.matchAll(/<node\b[^>]*\/?>/g)) {
    const node = m[0];
    const t = /\btext="([^"]*)"/.exec(node);
    if (!t || !t[1].includes(needle)) continue;
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!b) continue;
    out.push({ text: t[1], cx: ((+b[1] + +b[3]) / 2) | 0, cy: ((+b[2] + +b[4]) / 2) | 0 });
  }
  return out;
}

async function openList() {
  adb(['shell', 'am', 'force-stop', PKG]);
  await sleep(800);
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
  await sleep(3500);
}

async function openEndedTab() {
  const tab = nodesContaining(dump(), '終了した栽培')[0];
  if (!tab) throw new Error('「終了した栽培」の切り替えが無い');
  tap(tab.cx, tab.cy);
  await sleep(2000);
}

const main = async () => {
  // 1) E2E の残骸を消す（育成中・終了済みの両方）
  for (let round = 0; round < 8; round += 1) {
    await openList();
    let rows = nodesContaining(dump(), 'E2E');
    if (rows.length === 0) {
      await openEndedTab();
      rows = nodesContaining(dump(), 'E2E');
    }
    if (rows.length === 0) break;

    console.log(`E2E 残骸: ${rows[0].text}`);
    tap(rows[0].cx, rows[0].cy);
    await sleep(2000);

    let del = nodesContaining(dump(), '削除する');
    for (let i = 0; i < 4 && del.length === 0; i += 1) {
      adb(['shell', 'input', 'swipe', '540', '1800', '540', '700', '300']);
      await sleep(900);
      del = nodesContaining(dump(), '削除する');
    }
    if (del.length === 0) {
      console.log('  削除ボタンが出ない。中止');
      break;
    }
    tap(del[0].cx, del[0].cy);
    await sleep(1500);
    const confirms = nodesContaining(dump(), '削除する');
    if (confirms.length > 0) {
      tap(confirms[confirms.length - 1].cx, confirms[confirms.length - 1].cy);
      await sleep(2500);
    }
  }

  // 2) 終了させてしまったサンプル株を育成中へ戻す
  for (let round = 0; round < 6; round += 1) {
    await openList();
    await openEndedTab();
    const xml = dump();
    const target = SHOULD_BE_GROWING.map((name) => nodesContaining(xml, name)[0]).find(Boolean);
    if (!target) {
      console.log('育成中へ戻す株は残っていない');
      break;
    }
    console.log(`育成中へ戻す: ${target.text}`);
    tap(target.cx, target.cy);
    await sleep(2000);

    let resume = nodesContaining(dump(), '育成中に戻す');
    for (let i = 0; i < 4 && resume.length === 0; i += 1) {
      adb(['shell', 'input', 'swipe', '540', '1800', '540', '700', '300']);
      await sleep(900);
      resume = nodesContaining(dump(), '育成中に戻す');
    }
    if (resume.length === 0) {
      console.log('  「育成中に戻す」が出ない。中止');
      break;
    }
    tap(resume[0].cx, resume[0].cy);
    await sleep(2500);
  }

  // 3) 最終状態
  await openList();
  const growing = nodesContaining(dump(), '日目').length;
  await openEndedTab();
  const ended = nodesContaining(dump(), '日目').length;
  console.log(`\n最終: 育成中 ${growing} 件 / 終了 ${ended} 件（期待: 3 / 1）`);
};

main();

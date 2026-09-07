/**
 * ストア掲載スクリーンショットの単一ソース（store-shots.mjs）の検査。
 * 実行: `pnpm test:scripts`（node --test）。
 *
 * ここで固定したいのは「撮る側と載せる側の並びが 1 箇所から出ている」こと。
 * 2026-08-22 に 8 枚目を撮る側だけへ足し、`--dry-run` が無ければ 1 枚欠けたまま
 * 掲載していた（docs/レビュー記録/2026-08-22-release-1.1-retrospective.md A-4）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_PLAY_PHONE_SCREENSHOTS,
  orderByStoreOrder,
  storeShots,
  storeUploadOrder,
} from './store-shots.mjs';

test('storeShots は {planting} をサンプルデータの栽培 ID で埋める', () => {
  const shots = storeShots('planting-tomato-01');
  const detail = shots.find((shot) => shot.file === '03-planting-detail.png');
  const compare = shots.find((shot) => shot.file === '10-growth-record.png');

  assert.equal(detail.route, 'plantings/planting-tomato-01');
  assert.equal(compare.route, 'plantings/planting-tomato-01/compare');
  assert.ok(shots.every((shot) => !shot.route.includes('{planting}')));
});

test('storeShots が返すのは複製で、並べ替えても次の呼び出しに影響しない', () => {
  const first = storeShots('planting-a');
  first.reverse();
  assert.equal(storeShots('planting-b')[0].file, '01-home.png');
});

test('掲載順は storeOrder どおりで、Play の上限（8 枚）に収まる', () => {
  const order = storeUploadOrder();
  assert.equal(order[0], '01-home.png', '1 枚目は「何のアプリか」を言い切るホーム');
  assert.ok(order.length <= MAX_PLAY_PHONE_SCREENSHOTS);
  assert.equal(new Set(order).size, order.length, 'ファイル名の重複なし');
});

test('掲載するファイルは、すべて撮る側の定義に存在する（載せる側だけに増えない）', () => {
  const captured = storeShots('planting-tomato-01').map((shot) => shot.file);
  for (const file of storeUploadOrder()) {
    assert.ok(captured.includes(file), `${file} が撮影対象にない`);
  }
});

test('撮るが載せないショットがあってよい（Play は最大 8 枚・撮影は 10 枚）', () => {
  const captured = storeShots('planting-tomato-01').map((shot) => shot.file);
  assert.ok(captured.length > storeUploadOrder().length);
});

test('orderByStoreOrder はキャプションを掲載順へ並べ替える', () => {
  const captions = storeUploadOrder()
    .map((file) => ({ file }))
    .reverse();
  assert.deepEqual(
    orderByStoreOrder(captions).map((slide) => slide.file),
    storeUploadOrder(),
  );
});

test('キャプションが 1 枚足りなければ落ちる（A-4 の再発を、書き出し前に止める）', () => {
  const captions = storeUploadOrder()
    .slice(0, -1)
    .map((file) => ({ file }));
  assert.throws(() => orderByStoreOrder(captions), /キャプションが無い/);
});

test('掲載順に無いファイルのキャプションがあれば落ちる', () => {
  const captions = [...storeUploadOrder().map((file) => ({ file })), { file: '99-unknown.png' }];
  assert.throws(() => orderByStoreOrder(captions), /掲載順に入っていない/);
});

/**
 * ストア掲載スクリーンショットの**単一ソース**。
 *
 * 以前は「撮る側」（capture-store-screenshots.mjs / capture-ios-screenshots.mjs の
 * `SHOTS`）と「載せる側」（update-play-screenshots.mjs / update-asc-screenshots.mjs の
 * `ORDER`、compose-store-slides.mjs の `SLIDES`）で同じ並びを別々に持っていた。
 * 2026-08-22 に 8 枚目（`08-harvest-reads.png`）を撮る側だけに足してしまい、
 * **`--dry-run` が「plan (7 files)」と出さなければ 1 枚欠けたまま掲載されていた**
 * （docs/レビュー記録/2026-08-22-release-1.1-retrospective.md A-4）。
 * 二重管理そのものを消すため、定義をここ 1 箇所へ寄せた。
 *
 * ## 2 つの並びがある理由
 *
 * - **撮影順**（`file` の番号）= 追加した順。撮り直しのとき `--shots 08` のように
 *   番号で指定するので、**あとから振り直さない**（番号が指す画面が変わると
 *   過去の手順書・レビュー記録が全部ずれる）
 * - **掲載順**（`storeOrder`）= 訴求の強さ順。1 枚目で「何のアプリか」を言い切る。
 *   `storeOrder` を持たないショットは**撮るが載せない**（Play のスマホ用スクショは
 *   最大 8 枚で、10 枚撮って 8 枚選んでいる）
 *
 * 掲載しないショットを消さないのは、掲載枠の入れ替えを「番号の付け替え」ではなく
 * 「`storeOrder` の付け替え」で済ませるため。
 */

/** Play のスマホ用スクリーンショットの上限（App Store は 10 枚）。 */
export const MAX_PLAY_PHONE_SCREENSHOTS = 8;

/** 栽培 ID を差し込む場所。capture 側の `--planting` で入れ替えられる */
const PLANTING_PLACEHOLDER = '{planting}';

/**
 * ショット定義。`route` は Expo Router のパス（`saientecho://<route>` で開く）。
 * `manual: true` は自動遷移できない画面（撮影をスキップして既存ファイルを維持する）。
 *
 * **Android と iOS で同じ画面・同じ順序**にする。ずらすと 2 ストアで
 * 「同じアプリの別の顔」ができてしまう。
 */
const SHOT_DEFINITIONS = [
  { file: '01-home.png', route: '', label: 'ホーム（今日の菜園）', storeOrder: 1 },
  { file: '02-plantings.png', route: 'plantings', label: '栽培一覧' },
  {
    file: '03-planting-detail.png',
    route: `plantings/${PLANTING_PLACEHOLDER}`,
    label: '栽培詳細（やった！を記録）',
    storeOrder: 3,
  },
  { file: '04-harvests.png', route: 'harvests', label: '収穫アルバム', storeOrder: 5 },
  { file: '05-crop-guide.png', route: 'crops', label: '作物ガイド', storeOrder: 7 },
  { file: '06-calendar.png', route: 'calendar', label: 'カレンダー' },
  { file: '07-materials.png', route: 'materials', label: '資材の在庫', storeOrder: 8 },
  // 1.1 の目玉（#148）。**シードが「読み取り済み 1・待ち 1」をこの用途で用意している**
  // （seed.ts の seedHarvestPhotoReads）ので、ルートを開くだけで撮れる。
  {
    file: '08-harvest-reads.png',
    route: 'harvests/reads',
    label: '写真から記録（読み取り待ち）',
    storeOrder: 6,
  },
  // 1.2 の目玉（#152）。**ドラフトは DB に持たないのでシードで埋められない** —
  // 撮れるのは入口の空状態（「育てているものを撮って登録」）。
  // 中身の詰まった画面が要るなら、リワードを見て実際に読み取らせるしかない。
  {
    file: '09-planting-identify.png',
    route: 'plantings/identify',
    label: '写真から栽培を登録',
    storeOrder: 2,
  },
  // 1.2 の目玉（#161）。同じ栽培の写真を 2 枚並べて経過日数の差を出す。
  // **栽培詳細では折り返しの下**にあるので、直リンクで撮る
  // （simctl にスクロール手段が無く、Android だけスクロールすると両ストアで絵が変わる）。
  {
    file: '10-growth-record.png',
    route: `plantings/${PLANTING_PLACEHOLDER}/compare`,
    label: '成長記録',
    storeOrder: 4,
  },
];

/**
 * 定義そのものの検査。**読み込んだ時点で落とす** — 掲載直前の `--dry-run` まで
 * 気づけないと、A-4 と同じ「枚数が黙って減る」に戻る。
 */
function assertConsistent(definitions) {
  const files = definitions.map((shot) => shot.file);
  const duplicated = files.filter((file, index) => files.indexOf(file) !== index);
  if (duplicated.length > 0) {
    throw new Error(`store-shots: file が重複している: ${[...new Set(duplicated)].join(', ')}`);
  }

  const orders = definitions
    .filter((shot) => shot.storeOrder !== undefined)
    .map((shot) => shot.storeOrder)
    .sort((a, b) => a - b);
  orders.forEach((order, index) => {
    if (order !== index + 1) {
      throw new Error(
        `store-shots: storeOrder は 1 から連番にする（現在: ${orders.join(', ')}）。` +
          '載せないショットは storeOrder を書かないこと',
      );
    }
  });
  if (orders.length > MAX_PLAY_PHONE_SCREENSHOTS) {
    throw new Error(
      `store-shots: 掲載枠は最大 ${MAX_PLAY_PHONE_SCREENSHOTS} 枚（現在 ${orders.length} 枚）`,
    );
  }
}

assertConsistent(SHOT_DEFINITIONS);

/**
 * 撮影用のショット一覧。`route` の `{planting}` をサンプルデータの栽培 ID で埋める。
 * 返すのは複製なので、呼び出し側で並べ替えても定義は汚れない。
 */
export function storeShots(plantingId) {
  if (!plantingId) throw new Error('storeShots: plantingId は必須です');
  return SHOT_DEFINITIONS.map((shot) => ({
    ...shot,
    route: shot.route.split(PLANTING_PLACEHOLDER).join(plantingId),
  }));
}

/** 掲載順（= アップロード順）のファイル名。`storeOrder` を持つものだけ。 */
export function storeUploadOrder() {
  return SHOT_DEFINITIONS.filter((shot) => shot.storeOrder !== undefined)
    .sort((a, b) => a.storeOrder - b.storeOrder)
    .map((shot) => shot.file);
}

/**
 * キャプション定義（compose-store-slides.mjs の `SLIDES`）を掲載順に並べ替える。
 * **枚数と顔ぶれが掲載順と食い違ったら落とす** — キャプションだけ足して
 * `storeOrder` を振り忘れる（またはその逆）を、書き出し前に止める。
 */
export function orderByStoreOrder(slides) {
  const order = storeUploadOrder();
  const given = slides.map((slide) => slide.file);

  const missing = order.filter((file) => !given.includes(file));
  if (missing.length > 0) {
    throw new Error(`store-shots: 掲載するのにキャプションが無い: ${missing.join(', ')}`);
  }
  const extra = given.filter((file) => !order.includes(file));
  if (extra.length > 0) {
    throw new Error(
      `store-shots: キャプションはあるが掲載順に入っていない: ${extra.join(', ')}。` +
        'store-shots.mjs の storeOrder を振ること',
    );
  }
  return order.map((file) => slides.find((slide) => slide.file === file));
}

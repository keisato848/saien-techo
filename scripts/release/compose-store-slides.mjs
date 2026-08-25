/**
 * ストア掲載用のスライド（キャプション入りスクリーンショット）を書き出す。
 *
 * 素の画面キャプチャをそのまま並べると「何ができるか」は伝わっても
 * **「自分の何が楽になるのか」が伝わらない**。ストアの一覧で人が見るのは
 * 1 枚目の上半分だけなので、そこに**解決される困りごと**を置く。
 *
 * ## 決めごと
 *
 * - **見出しは機能名にしない。** 「作業ログ」ではなく「土のついた手でも、記録は 1 タップ」。
 *   機能名は副文に落とす（何の画面かは画像が示す）
 * - **改行は手で決める。** 和文の自動折り返しは意味の切れ目を無視するので、
 *   `headline` を配列で持ち、1 要素 = 1 行にする
 * - **素のキャプチャは消さない。** 入力は `phone-screenshots/`（capture-*.mjs の出力）、
 *   出力は `store-slides/`。撮り直しても文言はここに残る
 * - 文字はシステムフォントで描く（generate-feature-graphic.mjs と同じ方針）
 *
 * 使い方:
 *   node scripts/release/compose-store-slides.mjs            # 両プラットフォーム
 *   node scripts/release/compose-store-slides.mjs --play     # Play だけ
 *   node scripts/release/compose-store-slides.mjs --ios      # App Store だけ
 */
import fs from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 若葉パレット（apps/mobile/src/constants/theme.ts）
const BG = '#F6F8F1';
const ACCENT = '#5B9B3E';
const ACCENT_INK = '#2F4A25';
const ACCENT_SOFT = '#E7F1DC';
const INK = '#1A2513';
const INK_DIM = '#5E6B52';

const FONT = 'Yu Gothic UI, Yu Gothic, Meiryo, Noto Sans JP, sans-serif';

/**
 * スライド定義。**Play と App Store で共通**（同じ約束を同じ順で見せる）。
 *
 * 並び順 = 訴求の強さ順。1 枚目は一覧で必ず見えるので、最も広く刺さる
 * 「毎日の迷い」を置く。2〜4 枚目で記録と収穫（毎日使う理由）、
 * 5 枚目以降で調べもの・ふりかえり・買い物（続ける理由）。
 */
const SLIDES = [
  {
    file: '01-home.png',
    chip: '今日の菜園',
    headline: ['「きょう、何をすれば', 'いいんだっけ」が消える'],
    sub: [
      '追肥も水やりも、その日にやることだけがホームに出る。',
      '思い出すのはアプリの仕事にする。',
    ],
  },
  {
    file: '02-plantings.png',
    chip: '栽培の記録',
    headline: ['「これ、何日目', 'だったっけ？」がなくなる'],
    sub: [
      '植えた日を入れておけば、あとは自動で日数を数える。',
      '品種も植えた場所も、一覧でひと目。',
    ],
  },
  {
    file: '03-planting-detail.png',
    chip: '作業ログ',
    headline: ['土のついた手でも、', '記録は 1 タップで終わる'],
    sub: [
      '水やり・追肥・剪定・防除。写真とメモも添えられる。',
      'つけ忘れた日は、さかのぼって書ける。',
    ],
  },
  {
    file: '04-harvests.png',
    chip: '収穫アルバム',
    headline: ['採れた日が、そのまま', '来年の手がかりになる'],
    sub: [
      '撮るだけでアルバムに並ぶ。作物でしぼれるから、',
      '「去年のトマトはどうだった？」に答えが出る。',
    ],
  },
  {
    file: '08-harvest-reads.png',
    chip: '写真から記録',
    headline: ['収穫は撮るだけ。', '数を数えなくていい'],
    sub: [
      '写った作物と個数を読み取って、記録の下書きにする。',
      '数えきれないときは空のまま — 嘘の数字は入れない。',
    ],
  },
  {
    file: '05-crop-guide.png',
    chip: '作物ガイド',
    headline: ['株間も追肥の時期も、', 'もう検索しなくていい'],
    sub: [
      '30 作物の育て方を収録。日当たり・水やり・病害虫まで。',
      '農林水産省・JA グループなどの公開資料がもと。',
    ],
  },
  {
    file: '06-calendar.png',
    chip: 'ふりかえり',
    headline: ['来年の畑は、', '今年の記録が決めてくれる'],
    sub: [
      'いつ何をして、いつ採れたか。1 か月ぶんが 1 枚に。',
      '写真だけを並べて見ることもできる。',
    ],
  },
  {
    file: '07-materials.png',
    chip: '資材と買い物',
    headline: ['肥料の買い忘れで、', '週末をムダにしない'],
    sub: ['残りが少なくなったら通知。そのまま買い物リストへ。', 'ホームセンターで迷わない。'],
  },
];

/** プラットフォームごとの版面。レイアウトは幅を基準にスケールする */
const TARGETS = [
  {
    key: 'play',
    flag: '--play',
    src: 'docs/store/google-play/phone-screenshots',
    out: 'docs/store/google-play/store-slides',
    width: 1080,
    height: 2400,
  },
  {
    key: 'ios',
    flag: '--ios',
    src: 'docs/store/app-store/phone-screenshots',
    out: 'docs/store/app-store/store-slides',
    width: 1320,
    height: 2868,
  },
];

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * 背景。淡い若葉の面に畝を思わせる曲線を 2 本。
 * 曲線は**スクショの下に隠れる位置**に置く（キャプションの可読性を落とさないため）。
 */
function backgroundSvg(W, H, s, cardTop) {
  const y = Math.round(cardTop + 4 * s);
  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <path d="M${-40 * s} ${y} Q${W * 0.35} ${y - 70 * s} ${W + 40 * s} ${y + 24 * s}"
        fill="none" stroke="${ACCENT}" stroke-opacity="0.22" stroke-width="${14 * s}" stroke-linecap="round"/>
  <path d="M${-40 * s} ${y + 74 * s} Q${W * 0.45} ${y + 8 * s} ${W + 40 * s} ${y + 96 * s}"
        fill="none" stroke="${ACCENT}" stroke-opacity="0.13" stroke-width="${12 * s}" stroke-linecap="round"/>
</svg>`;
}

/** キャプション（チップ・見出し・副文）。y はすべて 1080 幅基準の値に s を掛ける */
function captionSvg(W, H, s, slide) {
  const x = Math.round(76 * s);
  const chipH = Math.round(58 * s);
  const chipY = Math.round(122 * s);
  // チップ幅は和文 1 文字 ≒ font-size で見積もる（描画してから測れないため）
  const chipFont = Math.round(30 * s);
  const chipW = Math.round(slide.chip.length * chipFont + 44 * s);

  const headFont = Math.round(74 * s);
  const headLead = Math.round(108 * s);
  const headTop = Math.round(300 * s);

  const subFont = Math.round(33 * s);
  const subLead = Math.round(50 * s);
  const subTop = headTop + (slide.headline.length - 1) * headLead + Math.round(90 * s);

  const heads = slide.headline
    .map(
      (line, i) =>
        `<text x="${x}" y="${headTop + i * headLead}" fill="${INK}" font-size="${headFont}" font-weight="700"
           letter-spacing="${1.5 * s}" font-family="${FONT}">${escapeXml(line)}</text>`,
    )
    .join('\n  ');
  const subs = slide.sub
    .map(
      (line, i) =>
        `<text x="${x}" y="${subTop + i * subLead}" fill="${INK_DIM}" font-size="${subFont}" font-weight="500"
           letter-spacing="${0.5 * s}" font-family="${FONT}">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="${ACCENT}" fill-opacity="0.14"/>
  <text x="${x + chipW / 2}" y="${chipY + chipH / 2 + chipFont * 0.36}" fill="${ACCENT_INK}" font-size="${chipFont}"
        font-weight="700" text-anchor="middle" letter-spacing="${1 * s}" font-family="${FONT}">${escapeXml(slide.chip)}</text>
  ${heads}
  ${subs}
</svg>`;
}

const roundedRect = (w, h, r, fill, opacity = 1) =>
  Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" fill-opacity="${opacity}"/>
     </svg>`,
  );

/**
 * 画面の**中身がどこで終わるか**を実測する（背景色と違う画素が現れる最下行）。
 *
 * 資材や読み取り待ちのように行数が少ない画面は、下半分が地の色のまま。
 * それをそのまま載せると「未完成の画面」に見えるので、中身の下で切る。
 * 最下部のナビゲーションバーは常に描かれているので**走査から外す**
 * （入れると必ず「最後まで中身がある」と判定されてしまう）。
 *
 * @returns {Promise<number>} 残す行数（source ピクセル）
 */
async function contentRows(srcPath) {
  const { data, info } = await sharp(srcPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x, y, c) => data[(y * width + x) * channels + c];
  // 地の色は「左端・縦 55% 地点」から取る（どの画面もここは余白）
  const bg = [
    at(4, Math.floor(height * 0.55), 0),
    at(4, Math.floor(height * 0.55), 1),
    at(4, Math.floor(height * 0.55), 2),
  ];
  const NAV = Math.round(height * 0.11); // 下端のナビ＋ジェスチャーバー
  const step = 3;
  for (let y = height - NAV; y >= 0; y -= 2) {
    let diff = 0;
    for (let x = 0; x < width; x += step) {
      if (
        Math.abs(at(x, y, 0) - bg[0]) > 10 ||
        Math.abs(at(x, y, 1) - bg[1]) > 10 ||
        Math.abs(at(x, y, 2) - bg[2]) > 10
      ) {
        diff += 1;
        if (diff > width / step / 100) return Math.min(height, y + Math.round(height * 0.02));
      }
    }
  }
  return height;
}

async function composeOne(target, slide, s) {
  const { width: W, height: H } = target;
  const srcPath = path.join(ROOT, target.src, slide.file);
  if (!fs.existsSync(srcPath)) return null;

  const shotW = Math.round(880 * s);
  const shotTop = Math.round(700 * s);
  const radius = Math.round(52 * s);

  const srcMeta = await sharp(srcPath).metadata();
  const keep = Math.min(srcMeta.height, await contentRows(srcPath));
  const sparse = keep < srcMeta.height * 0.94;
  const area = H - shotTop; // キャプションの下に使える高さ

  // **中身が少ない画面は幅を広げて「浮いたカード」にする。** 画面の下半分が
  // 地の色のまま残るより、背景（若葉のグラデーション）が見えるほうが意図的に見える。
  // 中身が最後まである画面は今までどおり下端からはみ出させる
  const cardW = sparse ? Math.min(Math.round(1000 * s), W - Math.round(80 * s)) : shotW;
  const cardLeft = Math.round((W - cardW) / 2);

  // **高さは resize の実測から取る。** 自前で比率計算すると sharp の丸めと
  // 1px ずれてマスクが下地より大きくなり「must have same dimensions or smaller」で落ちる
  const resized = await sharp(srcPath)
    .extract({ left: 0, top: 0, width: srcMeta.width, height: keep })
    .resize({ width: cardW })
    .png()
    .toBuffer();
  const shotH = (await sharp(resized).metadata()).height;
  // キャンバスからはみ出す分は切る（sharp は下地より大きい合成入力を受け付けない）
  const cropH = Math.min(shotH, area);
  const cardTop = shotH < area ? shotTop + Math.round((area - shotH) * 0.34) : shotTop;
  // **1 つの sharp インスタンスで composite と extract を混ぜない。**
  // sharp は extract を composite より先に適用するので、下地だけ先に切られて
  // 「must have same dimensions or smaller」で落ちる（実測 2026-08-24）
  const rounded = await sharp(resized)
    .composite([{ input: roundedRect(cardW, shotH, radius, '#ffffff'), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const shot = await sharp(rounded)
    .extract({ left: 0, top: 0, width: cardW, height: cropH })
    .png()
    .toBuffer();

  // 影は「ぼかした角丸」を下に敷くだけ。librsvg のフィルタに依存しない
  const blur = Math.round(22 * s);
  const shadow = await sharp(roundedRect(cardW, shotH, radius, ACCENT_INK, 0.22))
    .blur(blur)
    .extract({ left: 0, top: 0, width: cardW, height: cropH })
    .png()
    .toBuffer();

  const out = path.join(ROOT, target.out, slide.file);
  await sharp(Buffer.from(backgroundSvg(W, H, s, cardTop)))
    .composite([
      { input: shadow, left: cardLeft, top: cardTop + Math.round(12 * s) },
      { input: shot, left: cardLeft, top: cardTop },
      { input: Buffer.from(captionSvg(W, H, s, slide)), left: 0, top: 0 },
    ])
    .png()
    .toFile(out);

  const check = await sharp(out).metadata();
  if (check.width !== W || check.height !== H) {
    throw new Error(`${slide.file}: 寸法が違う ${check.width}x${check.height}（期待 ${W}x${H}）`);
  }
  return { file: slide.file, kb: Math.round(fs.statSync(out).size / 1024) };
}

const args = process.argv.slice(2);
const only = TARGETS.filter((t) => args.includes(t.flag));
const targets = only.length > 0 ? only : TARGETS;

for (const target of targets) {
  await mkdir(path.join(ROOT, target.out), { recursive: true });
  const s = target.width / 1080;
  console.log(`\n━━ ${target.key} (${target.width}x${target.height})`);
  let n = 0;
  for (const slide of SLIDES) {
    const r = await composeOne(target, slide, s);
    if (!r) {
      console.log(`  skip ${slide.file}（素材なし: ${target.src}）`);
      continue;
    }
    n += 1;
    console.log(
      `  ${String(n).padStart(2)}. ${r.file.padEnd(24)} ${String(r.kb).padStart(4)}KB  ${slide.headline.join('')}`,
    );
  }
  console.log(`  → ${target.out} に ${n} 枚`);
}

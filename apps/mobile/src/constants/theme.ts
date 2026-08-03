/**
 * さいえん手帳のテーマ
 *
 * 配色は 4 案をパレットとして持ち、`ACTIVE_PALETTE` を差し替えるだけで
 * アプリ全体の色が入れ替わる。既定は「若葉」（docs/画面設計.md §配色）。
 *
 * 案の比較モックは mockup/palette-compare.html。値はそこからそのまま持ってきている。
 *
 * ## Colors のキー名について
 *
 * `gold` / `paper` などはだいどこ由来の名前で、意味とずれている（gold は緑を指す）。
 * ただし 45 ファイル・400 箇所以上から参照されており、その大半は WBS 1.5 で
 * 栽培 UI に置き換わって消える。今リネームすると消えるコードを大量に触ることになるため、
 * **新しい画面は下の意味的な名前（accent / ink / surface …）を使い、
 * だいどこ由来のキーは移行期間の別名として残す**。
 * recipes 系の画面が消えた時点で別名も削除する。
 */

export type PaletteName = 'wakaba' | 'naedoko' | 'fukamidori' | 'tsuchi';

export interface Palette {
  /** 案の表示名 */
  label: string;
  /** 画面の背景 */
  bg: string;
  /** カード・シートの面 */
  surface: string;
  /** 入力欄の面 */
  surfaceInput: string;
  /** モーダル背後のオーバーレイ */
  overlay: string;
  /** 罫線 */
  line: string;
  /** 本文の文字色 */
  ink: string;
  /** 補助テキスト */
  inkDim: string;
  /** 主アクセント（ボタン・選択状態・リンク） */
  accent: string;
  /** アクセント面の上に置く文字 */
  accentInk: string;
  /** アクセントの淡い背景 */
  accentSoft: string;
  /** アクセントの淡い罫線 */
  accentLine: string;
  /** accent を背景にしたときの文字色 */
  onAccent: string;
  /** 収穫の強調色（アクセントとは別系統） */
  harvest: string;
  harvestSoft: string;
  harvestLine: string;
}

export const PALETTES: Record<PaletteName, Palette> = {
  // 春の新芽の黄緑。彩度が高く軽い。「これから育つ」印象。v0.1 の既定。
  wakaba: {
    label: '若葉',
    bg: '#F6F8F1',
    surface: '#FFFFFF',
    surfaceInput: '#EFF3E7',
    overlay: 'rgba(30,42,22,0.42)',
    line: '#DDE5D2',
    ink: '#1E2A16',
    inkDim: '#5E6B52',
    accent: '#5B9B3E',
    accentInk: '#2F4A25',
    accentSoft: '#EAF3E0',
    accentLine: '#CBE0B8',
    onAccent: '#FFFFFF',
    harvest: '#B4622A',
    harvestSoft: '#FBEEE2',
    harvestLine: '#EED6BE',
  },
  // 苗床の土とセージ。紙の菜園手帳の延長。彩度が低く写真が主役になる。
  naedoko: {
    label: '苗床',
    bg: '#F4F1E8',
    surface: '#FFFDF7',
    surfaceInput: '#EDE9DC',
    overlay: 'rgba(42,42,32,0.42)',
    line: '#E0DACA',
    ink: '#2A2A20',
    inkDim: '#6B675A',
    accent: '#6B7F4E',
    accentInk: '#43512D',
    accentSoft: '#EDEFE0',
    accentLine: '#D5D9C0',
    onAccent: '#FFFDF7',
    harvest: '#8A6B45',
    harvestSoft: '#F3EADD',
    harvestLine: '#DFCFB8',
  },
  // 青みの深い葉緑。輪郭が硬く、記録ツールとしての精度が出る。
  fukamidori: {
    label: '深緑',
    bg: '#F4F7F6',
    surface: '#FFFFFF',
    surfaceInput: '#EAF0EE',
    overlay: 'rgba(18,36,30,0.42)',
    line: '#D7E2DE',
    ink: '#12241E',
    inkDim: '#54655F',
    accent: '#1F6B52',
    accentInk: '#0F3D2E',
    accentSoft: '#E3F0EB',
    accentLine: '#C2DBD2',
    onAccent: '#FFFFFF',
    harvest: '#A85A2E',
    harvestSoft: '#F9EBE2',
    harvestLine: '#EBD2C1',
  },
  // 土の黒に葉の黄緑。夕方の屋外で見やすい暗色案。
  // CLAUDE.md §7 の「明るい緑基調」からは外れるため既定にはしない。
  tsuchi: {
    label: '土',
    bg: '#17170F',
    surface: '#20211A',
    surfaceInput: '#272920',
    overlay: 'rgba(10,10,6,0.62)',
    line: '#33352A',
    ink: '#E4E8D8',
    inkDim: '#8E9382',
    accent: '#8FBF5F',
    accentInk: '#C6DFA8',
    accentSoft: '#242A1B',
    accentLine: '#3C4630',
    onAccent: '#17170F',
    harvest: '#D9A05B',
    harvestSoft: '#2A2318',
    harvestLine: '#453A26',
  },
};

/**
 * 使用するパレット。
 *
 * 既定は若葉。`EXPO_PUBLIC_PALETTE` を設定してビルドすると差し替わるので、
 * 案の比較を実機で行うときはコードを触らずに切り替えられる。
 *   EXPO_PUBLIC_PALETTE=naedoko node scripts/agent/build-android.mjs --arch x86_64
 */
function resolvePalette(): PaletteName {
  const requested = process.env['EXPO_PUBLIC_PALETTE'];
  if (requested && requested in PALETTES) {
    return requested as PaletteName;
  }
  return 'wakaba';
}

export const ACTIVE_PALETTE: PaletteName = resolvePalette();

const p = PALETTES[ACTIVE_PALETTE];

/**
 * 選択中のパレットが暗色かどうか。
 * ステータスバーの文字色など、背景の明暗で分岐する箇所で使う。
 */
export const isDarkPalette: boolean = ACTIVE_PALETTE === 'tsuchi';

export const Colors = {
  // ── 意味的な名前。新しい画面はこちらを使う ──────────────────────
  bg: p.bg,
  surface: p.surface,
  surfaceInput: p.surfaceInput,
  overlay: p.overlay,
  line: p.line,
  ink: p.ink,
  inkDim: p.inkDim,
  accent: p.accent,
  accentInk: p.accentInk,
  accentSoft: p.accentSoft,
  accentLine: p.accentLine,
  onAccent: p.onAccent,
  harvest: p.harvest,
  harvestSoft: p.harvestSoft,
  harvestLine: p.harvestLine,
  white: '#FFFFFF',

  // ── だいどこ由来の別名（移行期間のみ）───────────────────────────
  // recipes 系の画面が消えた時点で削除する。新規コードでは使わない。
  // だいどこは暗色テーマで paper が文字色・bg が背景だったため、
  // 明色テーマでは paper → ink、bg → bg と対応させると反転が正しく収まる。
  bgCard: p.surface,
  bgInput: p.surfaceInput,
  bgOverlay: p.overlay,
  border: p.line,
  borderLight: p.accentLine,
  gold: p.accent,
  goldDim: p.accentInk,
  paper: p.ink,
  paperDim: p.inkDim,
  muted: p.inkDim,
} as const;

export const Fonts = {
  // 日本語は端末のシステムフォントで出す。webfont を積むと APK が膨らむうえ、
  // 和文の字面はシステムフォントの方が読みやすい。
  system: 'System',
} as const;

/**
 * Typography scale — docs/画面設計.md §タイポグラフィ 参照
 *
 * サイズ指針:
 *   xxs      : 11  — タグチップ・最小補助ラベル
 *   xs       : 12  — タイムスタンプ・メタ情報・経過日数
 *   sm       : 13  — フォームラベル・カード副情報・補足テキスト
 *   base     : 15  — 本文（作物名・メモ・カードタイトル・設定項目）
 *   md       : 17  — セクションヘッダー・ボタン CTA
 *   lg       : 20  — 画面タイトル・栽培名（詳細）
 *   xl       : 24  — ヒーロー数値（収穫数など）
 *
 * ウェイト指針:
 *   regular  : '400' — 本文・補足・説明
 *   medium   : '500' — カードタイトル・セクションヘッダー・画面タイトル
 *   semibold : '600' — ボタン CTA・強調ラベル・経過日数
 */
export const Typography = {
  size: {
    // だいどこ由来（recipes 系で参照中。1.5 で削除）
    wordmark: 9,
    timer: 36,
    xxs: 11,
    xs: 12,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
  },
} as const;

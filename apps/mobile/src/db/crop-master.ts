/**
 * 作物マスター — 栽培暦・作物ガイド（R08/R09 / WBS 3.1）
 *
 * 「今月の菜園仕事」（3.2）・作物ガイド（3.3）・「次の作業」（3.4）の元データ。
 * サンプルシード（seed.ts）とは別物で、**本番ビルドにも常に投入される**。
 *
 * 執筆の決め:
 * - 地域帯は寒冷地・中間地・暖地の 3 区分（§9）。中間地を基準に書き、
 *   寒冷地は春秋を約 1 か月内側へ、暖地は秋冬を約 1 か月外側へずらす
 * - 月単位。旬・上旬の粒度は持たない — 家庭菜園の判断は月で足りる
 * - 年またぎは startMonth > endMonth で表す（10 月〜翌 2 月 = 10, 2）
 * - 同じ kind に春秋 2 つの窓を持てる（例: ジャガイモ）。窓は最大 2 つ
 * - 一般的な露地・プランター栽培の目安。品種や年ごとの気候では前後する
 *   （利用規約の免責どおり「目安」であり、正確性はレビューで担保する）
 *
 * ここを変えたら CROP_MASTER_VERSION を上げること。据え置くと
 * 投入済みの端末が同期をスキップし、新しい行が入らない。
 */
import type { Region } from '../services/region.service';

// v2: 春夏 18 作物を追加して 30 作物に（3.1b 後半）
// v3: 公的資料と突き合わせて補正（寒冷地を JA 北海道の実期に合わせ 1〜2 か月前倒し、
//     暖地ジャガイモ秋作の植付を 8〜9 月に）。出典は CROP_MASTER_REFERENCES
export const CROP_MASTER_VERSION = 3;

export type CropCalendarKind = 'sow' | 'plant' | 'harvest';

export interface CropCalendarWindow {
  region: Region;
  kind: CropCalendarKind;
  /** 1〜12 */
  startMonth: number;
  /** 1〜12。startMonth より小さければ年またぎ */
  endMonth: number;
}

export interface CropGuideMaster {
  /** 株間の目安（cm） */
  spacingCm: number;
  /** full=日なた / partial=半日陰 */
  sunlight: 'full' | 'partial';
  wateringNote: string;
  /** 植え付け（または種まき）から追肥までの日数。R10 の判定に使う */
  fertilizeAfterDays: number | null;
  /** 植え付け（または種まき）から収穫までの日数。R10 の判定に使う */
  harvestAfterDays: number;
  /** 気をつける虫・病気 */
  commonPests: string[];
  tips: string;
}

export interface CropMaster {
  id: string;
  name: string;
  /** ひらがな。検索の読み仮名 */
  nameReading: string;
  /** 科。R17 連作障害チェックの判定キー */
  family: string;
  /** 収穫の既定単位（HARVEST_UNITS の語彙） */
  defaultUnit: 'piece' | 'g' | 'kg' | 'bunch' | 'plant';
  calendars: CropCalendarWindow[];
  guide: CropGuideMaster;
}

/**
 * 栽培暦・ガイドの出典（R08/R09）。
 *
 * 内容は下記の公開資料を参考に、家庭菜園向けの「月単位の目安」として
 * 独自にまとめ直したもの（表の転載ではない）。アプリ内では
 * 「今月の菜園仕事」カードと作物ガイドに小さく出典として表示する。
 * 検証の記録は docs/栽培暦の出典.md。
 */
export const CROP_MASTER_REFERENCES = [
  {
    name: '農林水産省「都道府県の施肥基準・野菜栽培技術指針」',
    url: 'https://www.maff.go.jp/j/seisan/kankyo/hozen_type/h_sehi_kizyun/',
  },
  {
    name: 'JAグループ北海道「チャレンジ！家庭菜園 主要野菜のは種・定植・収穫時期」',
    url: 'https://ja-dosanko.jp/agriculture/charenge/no7/',
  },
  {
    name: '長崎県農林技術開発センター「バレイショ栽培マニュアル」',
    url: 'https://www.pref.nagasaki.jp/e-nourin/nougi/manual/kogane2018.pdf',
  },
  {
    name: '農林水産省 消費者相談「国内のジャガイモの栽培時期」',
    url: 'https://www.maff.go.jp/j/heya/sodan/1204/01a.html',
  },
] as const;

/** アプリ内に小さく出す 1 行（カード・ガイドの脚注） */
export const CROP_MASTER_ATTRIBUTION = '農林水産省・JAグループ等の公開資料をもとにした目安です';

/**
 * 30 作物（WBS 3.1）。秋冬 12 + 春夏 18。
 * 秋冬を先に書いたのは、v1.0 公開（10 月）時点で「今月の仕事」に
 * 実データが載るようにするため。
 */
export const CROP_MASTER: CropMaster[] = [
  {
    id: 'crop-daikon',
    name: 'ダイコン',
    nameReading: 'だいこん',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'harvest', startMonth: 10, endMonth: 12 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 1 },
    ],
    guide: {
      spacingCm: 25,
      sunlight: 'full',
      wateringNote: '発芽まで乾かさない。根が育ちはじめたら控えめでよい。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'キスジノミハムシ', 'ヨトウムシ'],
      tips: '深く耕して石を取りのぞくと又根になりにくい。間引きは本葉 1 枚と 5〜6 枚のころの 2 回。',
    },
  },
  {
    id: 'crop-kabu',
    name: 'カブ',
    nameReading: 'かぶ',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 8, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 10, endMonth: 12 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 1 },
    ],
    guide: {
      spacingCm: 10,
      sunlight: 'full',
      wateringNote: '乾き続けると実が割れる。土の表面が乾いたらたっぷり。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 45,
      commonPests: ['アブラムシ', 'キスジノミハムシ'],
      tips: '小カブは密植でよく、間引き菜も食べられる。取り遅れると実が割れるので早めに収穫する。',
    },
  },
  {
    id: 'crop-ninjin',
    name: 'ニンジン',
    nameReading: 'にんじん',
    family: 'セリ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 7, endMonth: 8 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 1 },
      { region: 'warm', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'warm', kind: 'harvest', startMonth: 12, endMonth: 3 },
    ],
    guide: {
      spacingCm: 10,
      sunlight: 'full',
      wateringNote: '発芽が勝負。芽が出るまで 1 週間ほど毎日欠かさず湿らせる。',
      fertilizeAfterDays: 40,
      harvestAfterDays: 110,
      commonPests: ['キアゲハの幼虫', 'アブラムシ'],
      tips: '好光性なので土は薄くかける。発芽さえすれば半分成功と言われる。',
    },
  },
  {
    id: 'crop-hourensou',
    name: 'ホウレンソウ',
    nameReading: 'ほうれんそう',
    family: 'ヒユ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 1 },
      { region: 'warm', kind: 'sow', startMonth: 10, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 12, endMonth: 2 },
    ],
    guide: {
      spacingCm: 5,
      sunlight: 'full',
      wateringNote: '表面が乾いたらたっぷり。過湿は根腐れのもと。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 40,
      commonPests: ['アブラムシ', 'ヨトウムシ'],
      tips: '酸性の土が苦手。植え付け前に苦土石灰をよく混ぜる。寒さに当たると甘くなる。',
    },
  },
  {
    id: 'crop-komatsuna',
    name: 'コマツナ',
    nameReading: 'こまつな',
    family: 'アブラナ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 10, endMonth: 12 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 10, endMonth: 1 },
    ],
    guide: {
      spacingCm: 5,
      sunlight: 'full',
      wateringNote: '表面が乾いたらたっぷり。プランターでも育てやすい。',
      fertilizeAfterDays: 15,
      harvestAfterDays: 35,
      commonPests: ['アブラムシ', 'コナガ', 'カブラハバチ'],
      tips: '種まきから 1 か月あまりで収穫できる初心者向け。防虫ネットをかけると虫害がぐっと減る。',
    },
  },
  {
    id: 'crop-shungiku',
    name: 'シュンギク',
    nameReading: 'しゅんぎく',
    family: 'キク科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 10, endMonth: 12 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 2 },
    ],
    guide: {
      spacingCm: 10,
      sunlight: 'partial',
      wateringNote: '乾燥に弱い。表面が乾いたらたっぷり。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 40,
      commonPests: ['アブラムシ', 'ハモグリバエ'],
      tips: '摘み取り収穫にすると脇芽が伸びて長く楽しめる。香りが強く虫が付きにくい。',
    },
  },
  {
    id: 'crop-mizuna',
    name: 'ミズナ',
    nameReading: 'みずな',
    family: 'アブラナ科',
    defaultUnit: 'plant',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 1 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 2 },
    ],
    guide: {
      spacingCm: 15,
      sunlight: 'full',
      wateringNote: '水切れすると葉が固くなる。名前のとおり水を好む。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 40,
      commonPests: ['アブラムシ', 'コナガ'],
      tips: '小株どりなら密植で 30 日、大株どりなら株間を広く。サラダには小株が柔らかい。',
    },
  },
  {
    id: 'crop-hakusai',
    name: 'ハクサイ',
    nameReading: 'はくさい',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 7 },
      { region: 'cold', kind: 'plant', startMonth: 6, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 8, endMonth: 8 },
      { region: 'temperate', kind: 'plant', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 1 },
      { region: 'warm', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'warm', kind: 'plant', startMonth: 9, endMonth: 9 },
      { region: 'warm', kind: 'harvest', startMonth: 12, endMonth: 2 },
    ],
    guide: {
      spacingCm: 40,
      sunlight: 'full',
      wateringNote: '結球が始まるまでは乾かさない。始まったら控えめに。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 75,
      commonPests: ['アブラムシ', 'コナガ', 'ヨトウムシ'],
      tips: '植え付けが遅れると結球しない。適期を守るのがいちばんのコツ。防虫ネットは必須級。',
    },
  },
  {
    id: 'crop-kyabetsu',
    name: 'キャベツ',
    nameReading: 'きゃべつ',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 7 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 12, endMonth: 3 },
      { region: 'warm', kind: 'plant', startMonth: 10, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 3, endMonth: 5 },
    ],
    guide: {
      spacingCm: 40,
      sunlight: 'full',
      wateringNote: '植え付け直後はたっぷり。以後は表面が乾いたら。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 90,
      commonPests: ['アオムシ', 'コナガ', 'ヨトウムシ'],
      tips: 'モンシロチョウの幼虫（アオムシ）が大敵。植え付けと同時に防虫ネットをかける。',
    },
  },
  {
    id: 'crop-burokkori',
    name: 'ブロッコリー',
    nameReading: 'ぶろっこりー',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 7 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 2 },
      { region: 'warm', kind: 'plant', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 12, endMonth: 3 },
    ],
    guide: {
      spacingCm: 40,
      sunlight: 'full',
      wateringNote: '乾燥が続くときはたっぷり。特に植え付け後 2 週間。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 90,
      commonPests: ['アオムシ', 'コナガ', 'アブラムシ'],
      tips: '頂花蕾を採ったあとも側花蕾が次々出る。硬貨大のうちに追肥すると側花蕾が太る。',
    },
  },
  {
    id: 'crop-tamanegi',
    name: 'タマネギ',
    nameReading: 'たまねぎ',
    family: 'ヒガンバナ科',
    defaultUnit: 'piece',
    calendars: [
      // 寒冷地（北海道など）は春植え・夏どりが主流
      { region: 'cold', kind: 'sow', startMonth: 3, endMonth: 3 },
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 5 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'sow', startMonth: 9, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 11, endMonth: 11 },
      { region: 'temperate', kind: 'harvest', startMonth: 5, endMonth: 6 },
      { region: 'warm', kind: 'sow', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'plant', startMonth: 11, endMonth: 12 },
      { region: 'warm', kind: 'harvest', startMonth: 4, endMonth: 6 },
    ],
    guide: {
      spacingCm: 12,
      sunlight: 'full',
      wateringNote: '植え付け後と冬明けの生育期に乾いたら。冬の間は控えめ。',
      fertilizeAfterDays: 90,
      harvestAfterDays: 240,
      commonPests: ['アブラムシ', 'ベと病'],
      tips: '苗の太さは鉛筆の半分ほどが適。太すぎるととう立ちする。葉が倒れたら収穫の合図。',
    },
  },
  {
    id: 'crop-ninniku',
    name: 'ニンニク',
    nameReading: 'にんにく',
    family: 'ヒガンバナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 9, endMonth: 9 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 7 },
      { region: 'temperate', kind: 'plant', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'harvest', startMonth: 5, endMonth: 6 },
      { region: 'warm', kind: 'plant', startMonth: 10, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 4, endMonth: 5 },
    ],
    guide: {
      spacingCm: 15,
      sunlight: 'full',
      wateringNote: '植え付け後にたっぷり。以後は雨まかせでよいが、極端に乾く冬は少し。',
      fertilizeAfterDays: 120,
      harvestAfterDays: 240,
      commonPests: ['アブラムシ', 'さび病'],
      tips: '大きい鱗片を選んで植えると玉も大きくなる。春に伸びる花芽（ニンニクの芽）も食べられる。',
    },
  },
  // ─── 春夏作物（3.1b 後半・v2）────────────────────────────────────────────
  // crop-tomato / crop-cucumber / crop-basil は開発用サンプル(seed.ts)と同じ id。
  // マスターが upsert で正となり、サンプルの暦・ガイドは同期時に置き換わる。
  {
    id: 'crop-tomato',
    name: 'トマト',
    nameReading: 'とまと',
    family: 'ナス科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 9 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 45,
      sunlight: 'full',
      wateringNote: '乾かし気味に育てると甘くなる。実がつき始めたら定期的に。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'オオタバコガ', '尻腐れ（カルシウム不足）'],
      tips: '脇芽かきをこまめに。支柱は植え付けと同時に立てる。ミニトマトは初心者向け。',
    },
  },
  {
    id: 'crop-cucumber',
    name: 'キュウリ',
    nameReading: 'きゅうり',
    family: 'ウリ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 9 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 5, endMonth: 10 },
    ],
    guide: {
      spacingCm: 45,
      sunlight: 'full',
      wateringNote: '実のほとんどが水分。夏は毎朝たっぷり、水切れさせない。',
      fertilizeAfterDays: 15,
      harvestAfterDays: 40,
      commonPests: ['うどんこ病', 'アブラムシ', 'ウリハムシ'],
      tips: '成りはじめたら毎日見る。採り遅れるとヘチマのようになり株も疲れる。',
    },
  },
  {
    id: 'crop-nasu',
    name: 'ナス',
    nameReading: 'なす',
    family: 'ナス科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 50,
      sunlight: 'full',
      wateringNote: '水食い。夏は朝夕 2 回。乾くとツヤのない実（ボケナス）になる。',
      fertilizeAfterDays: 15,
      harvestAfterDays: 55,
      commonPests: ['アブラムシ', 'テントウムシダマシ', 'ハダニ'],
      tips: '3 本仕立てが基本。7 月末に切り戻す（更新剪定）と秋ナスが楽しめる。',
    },
  },
  {
    id: 'crop-piiman',
    name: 'ピーマン',
    nameReading: 'ぴーまん',
    family: 'ナス科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 11 },
    ],
    guide: {
      spacingCm: 45,
      sunlight: 'full',
      wateringNote: '乾燥に弱い。表面が乾いたらたっぷり。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 55,
      commonPests: ['アブラムシ', 'タバコガ', 'カメムシ'],
      tips: '一番花より下の脇芽はすべて取る。次々成るので若どりすると株が長持ちする。',
    },
  },
  {
    id: 'crop-okura',
    name: 'オクラ',
    nameReading: 'おくら',
    family: 'アオイ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 6, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'sow', startMonth: 5, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'warm', kind: 'sow', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '発芽まで湿らせる。真夏は乾いたらたっぷり。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'ハスモンヨトウ', 'カメムシ'],
      tips: '花が咲いて 4〜5 日で収穫。1 日採り遅れただけで固くなる。',
    },
  },
  {
    id: 'crop-edamame',
    name: 'エダマメ',
    nameReading: 'えだまめ',
    family: 'マメ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 4, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'warm', kind: 'sow', startMonth: 4, endMonth: 6 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 9 },
    ],
    guide: {
      spacingCm: 25,
      sunlight: 'full',
      wateringNote: '開花〜さやの太る時期に乾かすと実入りが悪くなる。',
      fertilizeAfterDays: null,
      harvestAfterDays: 80,
      commonPests: ['カメムシ', 'アブラムシ', 'マメシンクイガ'],
      tips: '根に付く根粒菌が肥料を作るので追肥はほぼ不要。やりすぎると葉ばかり茂る。',
    },
  },
  {
    id: 'crop-toumorokoshi',
    name: 'トウモロコシ',
    nameReading: 'とうもろこし',
    family: 'イネ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 10 },
      { region: 'temperate', kind: 'sow', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 7, endMonth: 8 },
      { region: 'warm', kind: 'sow', startMonth: 3, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 8 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '雄穂が出てから実が太るまでは水を切らさない。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 85,
      commonPests: ['アワノメイガ', 'アブラムシ', 'カラスなどの鳥害'],
      tips: '1 列より 2 列以上のかたまりで植えると受粉が安定して歯抜けになりにくい。',
    },
  },
  {
    id: 'crop-kabocha',
    name: 'カボチャ',
    nameReading: 'かぼちゃ',
    family: 'ウリ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 7, endMonth: 9 },
    ],
    guide: {
      spacingCm: 90,
      sunlight: 'full',
      wateringNote: '乾燥に強い。植え付け直後以外はほぼ雨まかせでよい。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 90,
      commonPests: ['うどんこ病', 'ウリハムシ', 'アブラムシ'],
      tips: 'ヘタがコルク状にひび割れたら収穫。採ってから 1〜2 週間置くと甘くなる。',
    },
  },
  {
    id: 'crop-goya',
    name: 'ゴーヤ',
    nameReading: 'ごーや',
    family: 'ウリ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 6, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 5, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 50,
      sunlight: 'full',
      wateringNote: '真夏は毎朝たっぷり。プランターの緑のカーテンは特に乾きやすい。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 50,
      commonPests: ['アブラムシ', 'ウリハムシ'],
      tips: '本葉 5〜6 枚で摘芯すると子づるが伸びて収量が増える。緑のカーテンにも向く。',
    },
  },
  {
    id: 'crop-zucchini',
    name: 'ズッキーニ',
    nameReading: 'ずっきーに',
    family: 'ウリ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 8 },
      { region: 'temperate', kind: 'plant', startMonth: 4, endMonth: 5 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 8 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 4 },
      { region: 'warm', kind: 'harvest', startMonth: 5, endMonth: 8 },
    ],
    guide: {
      spacingCm: 80,
      sunlight: 'full',
      wateringNote: '朝にたっぷり。葉が大きく蒸散が多い。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 45,
      commonPests: ['うどんこ病', 'アブラムシ', 'ウリハムシ'],
      tips: '朝のうちに雄花の花粉を雌花に付ける（人工授粉）と着果が安定。実は 20cm までに採る。',
    },
  },
  {
    id: 'crop-jagaimo',
    name: 'ジャガイモ',
    nameReading: 'じゃがいも',
    family: 'ナス科',
    defaultUnit: 'kg',
    calendars: [
      // 中間地・暖地は春植えと秋植えの 2 期作（同じ kind に 2 窓）
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 5 },
      { region: 'cold', kind: 'harvest', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 2, endMonth: 3 },
      { region: 'temperate', kind: 'plant', startMonth: 8, endMonth: 9 },
      { region: 'temperate', kind: 'harvest', startMonth: 5, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 12 },
      { region: 'warm', kind: 'plant', startMonth: 2, endMonth: 3 },
      { region: 'warm', kind: 'plant', startMonth: 8, endMonth: 9 },
      { region: 'warm', kind: 'harvest', startMonth: 5, endMonth: 6 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 12 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '植え付け後は控えめ。過湿は種芋が腐るいちばんの原因。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 100,
      commonPests: ['テントウムシダマシ', 'アブラムシ', 'そうか病'],
      tips: '芽かきで 2〜3 本に。芋が日に当たると緑化して食べられないので土寄せを 2 回。',
    },
  },
  {
    id: 'crop-satsumaimo',
    name: 'サツマイモ',
    nameReading: 'さつまいも',
    family: 'ヒルガオ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 6, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 10, endMonth: 11 },
      { region: 'warm', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'warm', kind: 'harvest', startMonth: 10, endMonth: 11 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '植え付け後 1 週間だけ乾かさない。あとはほぼ不要。',
      fertilizeAfterDays: null,
      harvestAfterDays: 120,
      commonPests: ['コガネムシの幼虫', 'ハスモンヨトウ'],
      tips: '肥料が残る土だとツルばかり茂る（ツルぼけ）。夏につる返しをして芋に養分を集める。',
    },
  },
  {
    id: 'crop-ichigo',
    name: 'イチゴ',
    nameReading: 'いちご',
    family: 'バラ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 9, endMonth: 9 },
      { region: 'cold', kind: 'harvest', startMonth: 6, endMonth: 7 },
      { region: 'temperate', kind: 'plant', startMonth: 10, endMonth: 11 },
      { region: 'temperate', kind: 'harvest', startMonth: 4, endMonth: 6 },
      { region: 'warm', kind: 'plant', startMonth: 10, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 3, endMonth: 5 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '乾いたら株元に。実に水がかかると傷みやすい。',
      fertilizeAfterDays: 150,
      harvestAfterDays: 210,
      commonPests: ['アブラムシ', 'ハダニ', 'うどんこ病'],
      tips: '花はランナーの反対側に付く。実の下にマルチや敷きわらを入れると汚れと病気を防げる。',
    },
  },
  {
    id: 'crop-hanegi',
    name: '葉ネギ',
    nameReading: 'はねぎ',
    family: 'ヒガンバナ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 4, endMonth: 5 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'sow', startMonth: 3, endMonth: 4 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 11 },
      { region: 'warm', kind: 'sow', startMonth: 3, endMonth: 4 },
      { region: 'warm', kind: 'harvest', startMonth: 5, endMonth: 12 },
    ],
    guide: {
      spacingCm: 5,
      sunlight: 'full',
      wateringNote: '表面が乾いたら。プランターでも育てやすい。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'さび病', 'ネギアザミウマ'],
      tips: '根元を 3cm ほど残して刈ると再生して何度も採れる。台所のプランター向き。',
    },
  },
  {
    id: 'crop-snap-endou',
    name: 'スナップエンドウ',
    nameReading: 'すなっぷえんどう',
    family: 'マメ科',
    defaultUnit: 'bunch',
    calendars: [
      // 寒冷地は春まき、中間地・暖地は秋まきで冬越し
      { region: 'cold', kind: 'sow', startMonth: 4, endMonth: 5 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 8 },
      { region: 'temperate', kind: 'sow', startMonth: 10, endMonth: 11 },
      { region: 'temperate', kind: 'harvest', startMonth: 4, endMonth: 6 },
      { region: 'warm', kind: 'sow', startMonth: 10, endMonth: 11 },
      { region: 'warm', kind: 'harvest', startMonth: 3, endMonth: 5 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '開花期に乾かさない。冬の間は控えめでよい。',
      fertilizeAfterDays: 120,
      harvestAfterDays: 180,
      commonPests: ['うどんこ病', 'ハモグリバエ', 'アブラムシ'],
      tips: '秋まきは本葉 2〜3 枚の小苗で冬越しさせるのがいちばん寒さに強い。大きくしすぎない。',
    },
  },
  {
    id: 'crop-shiso',
    name: 'シソ',
    nameReading: 'しそ',
    family: 'シソ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 5, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'sow', startMonth: 4, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'warm', kind: 'sow', startMonth: 4, endMonth: 6 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'partial',
      wateringNote: '乾燥すると葉が固くなる。半日陰でこまめに水やりすると柔らかく育つ。',
      fertilizeAfterDays: 30,
      harvestAfterDays: 40,
      commonPests: ['ハダニ', 'バッタ', 'ヨトウムシ'],
      tips: '摘芯して脇芽を増やすと長く採れる。こぼれ種で翌年も生えてくる。',
    },
  },
  {
    id: 'crop-basil',
    name: 'バジル',
    nameReading: 'ばじる',
    family: 'シソ科',
    defaultUnit: 'bunch',
    calendars: [
      { region: 'cold', kind: 'plant', startMonth: 6, endMonth: 6 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 9 },
      { region: 'temperate', kind: 'plant', startMonth: 5, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 6, endMonth: 10 },
      { region: 'warm', kind: 'plant', startMonth: 4, endMonth: 6 },
      { region: 'warm', kind: 'harvest', startMonth: 6, endMonth: 10 },
    ],
    guide: {
      spacingCm: 25,
      sunlight: 'full',
      wateringNote: '水好き。表面が乾いたらたっぷり。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 30,
      commonPests: ['アブラムシ', 'ハダニ', 'ベニフキノメイガ'],
      tips: '花穂が付いたら早めに摘む（葉が固くなる）。摘芯するたびに収量が増える。',
    },
  },
  {
    id: 'crop-retasu',
    name: 'レタス',
    nameReading: 'れたす',
    family: 'キク科',
    defaultUnit: 'piece',
    calendars: [
      // 中間地・暖地は春と秋の 2 期作
      { region: 'cold', kind: 'plant', startMonth: 5, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 7, endMonth: 10 },
      { region: 'temperate', kind: 'plant', startMonth: 3, endMonth: 4 },
      { region: 'temperate', kind: 'plant', startMonth: 9, endMonth: 9 },
      { region: 'temperate', kind: 'harvest', startMonth: 5, endMonth: 6 },
      { region: 'temperate', kind: 'harvest', startMonth: 11, endMonth: 12 },
      { region: 'warm', kind: 'plant', startMonth: 2, endMonth: 3 },
      { region: 'warm', kind: 'plant', startMonth: 9, endMonth: 10 },
      { region: 'warm', kind: 'harvest', startMonth: 4, endMonth: 5 },
      { region: 'warm', kind: 'harvest', startMonth: 11, endMonth: 1 },
    ],
    guide: {
      spacingCm: 30,
      sunlight: 'full',
      wateringNote: '朝に。結球が始まったら控えめにすると病気が出にくい。',
      fertilizeAfterDays: 20,
      harvestAfterDays: 60,
      commonPests: ['アブラムシ', 'ナメクジ', 'ヨトウムシ'],
      tips: '高温だと発芽しない。夏まきは濡らした種を冷蔵庫で 2〜3 日芽出ししてからまく。',
    },
  },
];

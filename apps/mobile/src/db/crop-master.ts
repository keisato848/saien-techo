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

export const CROP_MASTER_VERSION = 1;

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
 * 30 作物が目標（WBS 3.1）。まず秋冬 12 作物 — 8〜10 月に種まき・植え付けが
 * 始まるものから書く。v1.0 公開（10 月）時点で「今月の仕事」に実データが載る。
 * 残り（春夏 18 作物）は 3.1b の後半で足す。
 */
export const CROP_MASTER: CropMaster[] = [
  {
    id: 'crop-daikon',
    name: 'ダイコン',
    nameReading: 'だいこん',
    family: 'アブラナ科',
    defaultUnit: 'piece',
    calendars: [
      { region: 'cold', kind: 'sow', startMonth: 7, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 11 },
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
      { region: 'cold', kind: 'sow', startMonth: 7, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 10 },
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
      { region: 'cold', kind: 'sow', startMonth: 6, endMonth: 7 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 11 },
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
      { region: 'cold', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 11 },
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
      { region: 'cold', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 10 },
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
      { region: 'cold', kind: 'sow', startMonth: 8, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 10 },
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
      { region: 'cold', kind: 'sow', startMonth: 8, endMonth: 9 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 11 },
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
      { region: 'cold', kind: 'sow', startMonth: 7, endMonth: 7 },
      { region: 'cold', kind: 'plant', startMonth: 7, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 10, endMonth: 11 },
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
      { region: 'cold', kind: 'plant', startMonth: 7, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 10, endMonth: 11 },
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
      { region: 'cold', kind: 'plant', startMonth: 7, endMonth: 8 },
      { region: 'cold', kind: 'harvest', startMonth: 9, endMonth: 11 },
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
      { region: 'cold', kind: 'plant', startMonth: 4, endMonth: 5 },
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
];

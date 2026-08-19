/**
 * Optional sample seed data
 * Based on mockup/app-mockup.jsx RECIPES, RECIPE_INGREDIENTS, STEPS, TIMELINE
 */

// ─── IDs ────────────────────────────────────────────────────────────────────
const FAMILY_ID = 'family-001';
const USER_KEI = 'user-kei';
const USER_KEN = 'user-ken';
const USER_YO = 'user-yo';

// ─── Users ──────────────────────────────────────────────────────────────────
export const seedUsers = [
  {
    id: USER_KEI,
    displayName: '恵',
    avatarUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: USER_KEN,
    displayName: '健',
    avatarUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: USER_YO,
    displayName: '陽',
    avatarUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
] as const;

// ─── Family ─────────────────────────────────────────────────────────────────
export const seedFamilies = [
  {
    id: FAMILY_ID,
    name: 'わたしの菜園',
    inviteCode: 'ABC123',
    ownerId: USER_KEI,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
] as const;

// ══════════════════════════════════════════════════════════════════════════
// さいえん手帳の開発用サンプル（WBS 1.3）
//
// 作物マスターの本番データ投入は WBS 3.1（30 作物）。ここに置くのは
// 画面確認用の最小セットで、本番マスターの代わりではない。
// 日付は「実行日からの相対」にして、いつ実行しても
// 「植え付けから N 日経過」の表示が現実的な値になるようにする。
// ══════════════════════════════════════════════════════════════════════════

const SAIEN_NOW = new Date();

/** 実行日から days 日前の ISO 文字列 */
function daysAgoIso(days: number): string {
  const d = new Date(SAIEN_NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const SAIEN_TIMESTAMP = SAIEN_NOW.toISOString();

export const seedCrops = [
  {
    id: 'crop-tomato',
    name: 'トマト',
    nameReading: 'とまと',
    family: 'ナス科',
    defaultUnit: 'piece',
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    id: 'crop-cucumber',
    name: 'キュウリ',
    nameReading: 'きゅうり',
    family: 'ウリ科',
    defaultUnit: 'piece',
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    id: 'crop-basil',
    name: 'バジル',
    nameReading: 'ばじる',
    family: 'シソ科',
    defaultUnit: 'bunch',
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
] as const;

export const seedCropGuides = [
  {
    cropId: 'crop-tomato',
    spacingCm: 50,
    sunlight: 'full',
    wateringNote: '土の表面が乾いたらたっぷり。過湿は裂果の原因になる',
    fertilizeAfterDays: 21,
    harvestAfterDays: 60,
    commonPests: JSON.stringify(['アブラムシ', 'オオタバコガ', '尻腐れ症']),
    tips: '第一花房が咲いたら追肥を始める。わき芽は早めにかき取る',
  },
  {
    cropId: 'crop-cucumber',
    spacingCm: 45,
    sunlight: 'full',
    wateringNote: '乾燥に弱い。夏場は朝夕 2 回',
    fertilizeAfterDays: 14,
    harvestAfterDays: 40,
    commonPests: JSON.stringify(['うどんこ病', 'ウリハムシ']),
    tips: '採り遅れると株が疲れる。若採りを心がける',
  },
  {
    cropId: 'crop-basil',
    spacingCm: 25,
    sunlight: 'full',
    wateringNote: '乾かしすぎない。葉がしおれる前に',
    fertilizeAfterDays: 30,
    harvestAfterDays: 30,
    commonPests: JSON.stringify(['ヨトウムシ']),
    tips: '摘芯すると脇芽が伸びて収量が増える',
  },
] as const;

/** 中間地（temperate）だけの最小セット。寒冷地・暖地は WBS 3.1 で追加する */
export const seedCropCalendars = [
  {
    id: 'cal-tomato-temperate-plant',
    cropId: 'crop-tomato',
    region: 'temperate',
    kind: 'plant',
    startMonth: 4,
    endMonth: 6,
  },
  {
    id: 'cal-tomato-temperate-harvest',
    cropId: 'crop-tomato',
    region: 'temperate',
    kind: 'harvest',
    startMonth: 6,
    endMonth: 9,
  },
  {
    id: 'cal-cucumber-temperate-plant',
    cropId: 'crop-cucumber',
    region: 'temperate',
    kind: 'plant',
    startMonth: 4,
    endMonth: 6,
  },
  {
    id: 'cal-cucumber-temperate-harvest',
    cropId: 'crop-cucumber',
    region: 'temperate',
    kind: 'harvest',
    startMonth: 6,
    endMonth: 9,
  },
  {
    id: 'cal-basil-temperate-sow',
    cropId: 'crop-basil',
    region: 'temperate',
    kind: 'sow',
    startMonth: 4,
    endMonth: 7,
  },
] as const;

export const seedPlaces = [
  {
    id: 'place-planter-a',
    familyId: FAMILY_ID,
    name: 'ベランダ プランターA',
    kind: 'planter',
    note: null,
    sortOrder: 1,
    archivedAt: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    id: 'place-row-south',
    familyId: FAMILY_ID,
    name: '南の畝',
    kind: 'row',
    note: '日当たり良好',
    sortOrder: 2,
    archivedAt: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
] as const;

export const seedPlantings = [
  {
    id: 'planting-tomato-01',
    familyId: FAMILY_ID,
    cropId: 'crop-tomato',
    cropName: 'トマト',
    cropNameReading: 'とまと',
    variety: 'アイコ',
    placeId: 'place-row-south',
    plantedOn: daysAgoIso(45),
    plantedAs: 'seedling',
    coverPhotoPath: null,
    note: '今年は雨よけをつけた',
    endedAt: null,
    endedReason: null,
    createdAt: daysAgoIso(45),
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    id: 'planting-cucumber-01',
    familyId: FAMILY_ID,
    cropId: 'crop-cucumber',
    cropName: 'キュウリ',
    cropNameReading: 'きゅうり',
    variety: null,
    placeId: 'place-row-south',
    plantedOn: daysAgoIso(30),
    plantedAs: 'seedling',
    coverPhotoPath: null,
    note: null,
    endedAt: null,
    endedReason: null,
    createdAt: daysAgoIso(30),
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    // マスターに無い作物（crop_id が NULL）のケース。自由入力の動作確認用
    id: 'planting-shiso-01',
    familyId: FAMILY_ID,
    cropId: null,
    cropName: 'アオジソ',
    cropNameReading: 'あおじそ',
    variety: null,
    placeId: 'place-planter-a',
    plantedOn: daysAgoIso(60),
    plantedAs: 'seed',
    coverPhotoPath: null,
    note: 'こぼれ種から',
    endedAt: null,
    endedReason: null,
    createdAt: daysAgoIso(60),
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    // 栽培終了済み（アーカイブ表示の確認用）
    id: 'planting-basil-01',
    familyId: FAMILY_ID,
    cropId: 'crop-basil',
    cropName: 'バジル',
    cropNameReading: 'ばじる',
    variety: null,
    placeId: 'place-planter-a',
    plantedOn: daysAgoIso(120),
    plantedAs: 'seed',
    coverPhotoPath: null,
    note: null,
    endedAt: daysAgoIso(10),
    endedReason: 'harvested',
    createdAt: daysAgoIso(120),
    updatedAt: daysAgoIso(10),
  },
] as const;

export const seedCareLogs = [
  {
    id: 'care-log-01',
    plantingId: 'planting-tomato-01',
    kind: 'water',
    loggedAt: daysAgoIso(1),
    note: null,
    createdAt: daysAgoIso(1),
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'care-log-02',
    plantingId: 'planting-tomato-01',
    kind: 'fertilize',
    loggedAt: daysAgoIso(24),
    note: '第一花房が咲いたので追肥',
    createdAt: daysAgoIso(24),
    updatedAt: daysAgoIso(24),
  },
  {
    id: 'care-log-03',
    plantingId: 'planting-tomato-01',
    kind: 'prune',
    loggedAt: daysAgoIso(12),
    note: 'わき芽かき',
    createdAt: daysAgoIso(12),
    updatedAt: daysAgoIso(12),
  },
  {
    id: 'care-log-04',
    plantingId: 'planting-cucumber-01',
    kind: 'water',
    loggedAt: daysAgoIso(1),
    note: null,
    createdAt: daysAgoIso(1),
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'care-log-05',
    plantingId: 'planting-cucumber-01',
    kind: 'pest',
    loggedAt: daysAgoIso(5),
    note: 'うどんこ病が出たので薬剤散布',
    createdAt: daysAgoIso(5),
    updatedAt: daysAgoIso(5),
  },
] as const;

export const seedHarvests = [
  {
    id: 'harvest-01',
    plantingId: 'planting-tomato-01',
    harvestedAt: daysAgoIso(3),
    quantity: 5,
    unit: 'piece',
    note: '初収穫',
    createdAt: daysAgoIso(3),
    updatedAt: daysAgoIso(3),
  },
  {
    // 数量なし（任意入力の確認用。写真だけでも成立する — R06）
    id: 'harvest-02',
    plantingId: 'planting-tomato-01',
    harvestedAt: daysAgoIso(1),
    quantity: null,
    unit: null,
    note: null,
    createdAt: daysAgoIso(1),
    updatedAt: daysAgoIso(1),
  },
  {
    id: 'harvest-03',
    plantingId: 'planting-cucumber-01',
    harvestedAt: daysAgoIso(2),
    quantity: 3,
    unit: 'piece',
    note: null,
    createdAt: daysAgoIso(2),
    updatedAt: daysAgoIso(2),
  },
  {
    id: 'harvest-04',
    plantingId: 'planting-basil-01',
    harvestedAt: daysAgoIso(15),
    quantity: 2,
    unit: 'bunch',
    note: null,
    createdAt: daysAgoIso(15),
    updatedAt: daysAgoIso(15),
  },
  {
    // 「写真の読み取り」の読み取り待ち（#143 のスクショ用）。数量なし・写真なしで
    // キューに乗る形（写真の実体はサンプルに増やさない — 配布サイズを膨らませない）
    id: 'harvest-05',
    plantingId: 'planting-cucumber-01',
    harvestedAt: daysAgoIso(0),
    quantity: null,
    unit: null,
    note: null,
    createdAt: daysAgoIso(0),
    updatedAt: daysAgoIso(0),
  },
] as const;

/**
 * 「写真の読み取り」の状態（#143）。ストア掲載スクショは対話フローを踏めないため、
 * 「1 枚は読み取り済み・1 枚は待ち」の画面をシードで再現する（I8 指示書の前提）。
 */
export const seedHarvestPhotoReads = [
  {
    // harvest-02（数量なしのトマト・写真つき）: 読み取り済み・確認待ち
    harvestId: 'harvest-02',
    state: 'analyzed',
    paid: 1,
    attempts: 1,
    cropGuess: 'ミニトマト',
    cropConfidence: 'high',
    count: 8,
    countConfidence: 'high',
    readNote: null,
    createdAt: daysAgoIso(1),
    updatedAt: daysAgoIso(0),
  },
  {
    // harvest-05: これから読むもの
    harvestId: 'harvest-05',
    state: 'pending',
    paid: 0,
    attempts: 0,
    cropGuess: null,
    cropConfidence: null,
    count: null,
    countConfidence: null,
    readNote: null,
    createdAt: daysAgoIso(0),
    updatedAt: daysAgoIso(0),
  },
] as const;

export const seedMaterials = [
  {
    id: 'material-01',
    familyId: FAMILY_ID,
    name: '化成肥料 8-8-8',
    category: 'fertilizer',
    quantity: 1.5,
    unit: 'kg',
    lowThreshold: 0.5,
    janCode: null,
    note: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    id: 'material-02',
    familyId: FAMILY_ID,
    name: '培養土',
    category: 'soil',
    quantity: 10,
    unit: 'L',
    lowThreshold: 5,
    janCode: null,
    note: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    // 閾値割れ（低在庫通知の確認用）
    id: 'material-03',
    familyId: FAMILY_ID,
    name: 'トマトの種（アイコ）',
    category: 'seed',
    quantity: 1,
    unit: '袋',
    lowThreshold: 2,
    janCode: null,
    note: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
  {
    // 数量を持たない資材。一覧で ± を出さない側の確認用
    id: 'material-04',
    familyId: FAMILY_ID,
    name: '移植ごて',
    category: 'tool',
    quantity: null,
    unit: null,
    lowThreshold: null,
    janCode: null,
    note: null,
    createdAt: SAIEN_TIMESTAMP,
    updatedAt: SAIEN_TIMESTAMP,
  },
] as const;

/**
 * 栽培に使うタグ。だいどこの seedTags（肉・汁物・揚げ物…）は料理の語彙なので
 * 栽培のタグ候補には出さない。tags テーブル自体は共有だが、
 * 栽培フォームの候補は「栽培に付いているタグ」だけを引く（planting.service）。
 */
export const seedPlantingTagMasters = [
  { id: 'tag-p01', familyId: FAMILY_ID, name: '夏野菜', color: null },
  { id: 'tag-p02', familyId: FAMILY_ID, name: '実もの', color: null },
  { id: 'tag-p03', familyId: FAMILY_ID, name: '葉もの', color: null },
  { id: 'tag-p04', familyId: FAMILY_ID, name: 'ハーブ', color: null },
  { id: 'tag-p05', familyId: FAMILY_ID, name: 'プランター', color: null },
] as const;

export const seedPlantingTags = [
  { plantingId: 'planting-tomato-01', tagId: 'tag-p01' },
  { plantingId: 'planting-tomato-01', tagId: 'tag-p02' },
  { plantingId: 'planting-cucumber-01', tagId: 'tag-p01' },
  { plantingId: 'planting-cucumber-01', tagId: 'tag-p02' },
  { plantingId: 'planting-shiso-01', tagId: 'tag-p03' },
  { plantingId: 'planting-shiso-01', tagId: 'tag-p05' },
  { plantingId: 'planting-basil-01', tagId: 'tag-p04' },
  { plantingId: 'planting-basil-01', tagId: 'tag-p05' },
] as const;

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
    name: '佐藤家の台所',
    inviteCode: 'ABC123',
    ownerId: USER_KEI,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
] as const;

// ─── Recipes ────────────────────────────────────────────────────────────────
export const seedRecipes = [
  {
    id: 'recipe-1',
    familyId: FAMILY_ID,
    title: '肉じゃが',
    titleReading: 'にくじゃが',
    currentRevId: 'rev-1',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-05-04T00:00:00.000Z',
  },
  {
    id: 'recipe-2',
    familyId: FAMILY_ID,
    title: '味噌汁',
    titleReading: 'みそしる',
    currentRevId: 'rev-2',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-05-03T00:00:00.000Z',
  },
  {
    id: 'recipe-3',
    familyId: FAMILY_ID,
    title: '唐揚げ',
    titleReading: 'からあげ',
    currentRevId: 'rev-3',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-04-28T00:00:00.000Z',
  },
  {
    id: 'recipe-4',
    familyId: FAMILY_ID,
    title: '炊き込みご飯',
    titleReading: 'たきこみごはん',
    currentRevId: 'rev-4',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-04-20T00:00:00.000Z',
  },
  {
    id: 'recipe-5',
    familyId: FAMILY_ID,
    title: '豚汁',
    titleReading: 'とんじる',
    currentRevId: 'rev-5',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-04-15T00:00:00.000Z',
  },
  {
    id: 'recipe-6',
    familyId: FAMILY_ID,
    title: 'ハンバーグ',
    titleReading: 'はんばーぐ',
    currentRevId: 'rev-6',
    status: 'active' as const,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-04-10T00:00:00.000Z',
  },
] as const;

// ─── RecipeRevisions ────────────────────────────────────────────────────────
export const seedRevisions = [
  {
    id: 'rev-1',
    recipeId: 'recipe-1',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 30,
    prepTimeMin: 15,
    description: '定番の家庭料理。ほくほくのじゃがいもに味がしみた一品。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'rev-2',
    recipeId: 'recipe-2',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 10,
    prepTimeMin: 5,
    description: '毎日飲みたいおふくろの味。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'rev-3',
    recipeId: 'recipe-3',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 25,
    prepTimeMin: 30,
    description: 'サクッとジューシーな唐揚げ。下味をしっかりつけるのがコツ。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'rev-4',
    recipeId: 'recipe-4',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 45,
    prepTimeMin: 15,
    description: '秋の味覚をたっぷり炊き込んだご飯。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'rev-5',
    recipeId: 'recipe-5',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 20,
    prepTimeMin: 15,
    description: '野菜たっぷりのあったか豚汁。冬の定番。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'rev-6',
    recipeId: 'recipe-6',
    revisionNumber: 1,
    isMajor: true,
    servings: 4,
    cookTimeMin: 35,
    prepTimeMin: 20,
    description: 'ふっくらジューシーなハンバーグ。ソースも手作り。',
    authorNote: null,
    sourceId: null,
    createdBy: USER_KEI,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
] as const;

// ─── Ingredients ────────────────────────────────────────────────────────────
export const seedIngredients = [
  // Recipe 1: 肉じゃが
  {
    id: 'ing-1-01',
    revisionId: 'rev-1',
    sortOrder: 1,
    groupLabel: null,
    name: 'じゃがいも（メークイン）',
    amount: '3個',
    note: null,
  },
  {
    id: 'ing-1-02',
    revisionId: 'rev-1',
    sortOrder: 2,
    groupLabel: null,
    name: '玉ねぎ',
    amount: '1個',
    note: null,
  },
  {
    id: 'ing-1-03',
    revisionId: 'rev-1',
    sortOrder: 3,
    groupLabel: null,
    name: '牛薄切り肉',
    amount: '200g',
    note: null,
  },
  {
    id: 'ing-1-04',
    revisionId: 'rev-1',
    sortOrder: 4,
    groupLabel: null,
    name: 'にんじん',
    amount: '½本',
    note: null,
  },
  {
    id: 'ing-1-05',
    revisionId: 'rev-1',
    sortOrder: 5,
    groupLabel: 'A 調味料',
    name: '醤油',
    amount: '大さじ3',
    note: null,
  },
  {
    id: 'ing-1-06',
    revisionId: 'rev-1',
    sortOrder: 6,
    groupLabel: 'A 調味料',
    name: 'みりん',
    amount: '大さじ3',
    note: null,
  },
  {
    id: 'ing-1-07',
    revisionId: 'rev-1',
    sortOrder: 7,
    groupLabel: 'A 調味料',
    name: '砂糖',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-1-08',
    revisionId: 'rev-1',
    sortOrder: 8,
    groupLabel: 'A 調味料',
    name: 'だし汁',
    amount: '300ml',
    note: null,
  },

  // Recipe 2: 味噌汁
  {
    id: 'ing-2-01',
    revisionId: 'rev-2',
    sortOrder: 1,
    groupLabel: null,
    name: '豆腐',
    amount: '½丁',
    note: null,
  },
  {
    id: 'ing-2-02',
    revisionId: 'rev-2',
    sortOrder: 2,
    groupLabel: null,
    name: 'わかめ',
    amount: '適量',
    note: null,
  },
  {
    id: 'ing-2-03',
    revisionId: 'rev-2',
    sortOrder: 3,
    groupLabel: null,
    name: '玉ねぎ',
    amount: '½個',
    note: null,
  },
  {
    id: 'ing-2-04',
    revisionId: 'rev-2',
    sortOrder: 4,
    groupLabel: 'A 調味料',
    name: '味噌',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-2-05',
    revisionId: 'rev-2',
    sortOrder: 5,
    groupLabel: 'A 調味料',
    name: 'だし汁',
    amount: '600ml',
    note: null,
  },

  // Recipe 3: 唐揚げ
  {
    id: 'ing-3-01',
    revisionId: 'rev-3',
    sortOrder: 1,
    groupLabel: null,
    name: '鶏もも肉',
    amount: '500g',
    note: null,
  },
  {
    id: 'ing-3-02',
    revisionId: 'rev-3',
    sortOrder: 2,
    groupLabel: 'A 下味',
    name: '醤油',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-3-03',
    revisionId: 'rev-3',
    sortOrder: 3,
    groupLabel: 'A 下味',
    name: 'にんにく',
    amount: '2かけ',
    note: null,
  },
  {
    id: 'ing-3-04',
    revisionId: 'rev-3',
    sortOrder: 4,
    groupLabel: 'A 下味',
    name: 'しょうが',
    amount: '1かけ',
    note: null,
  },
  {
    id: 'ing-3-05',
    revisionId: 'rev-3',
    sortOrder: 5,
    groupLabel: 'A 下味',
    name: '酒',
    amount: '大さじ1',
    note: null,
  },
  {
    id: 'ing-3-06',
    revisionId: 'rev-3',
    sortOrder: 6,
    groupLabel: 'B 衣',
    name: '片栗粉',
    amount: '適量',
    note: null,
  },
  {
    id: 'ing-3-07',
    revisionId: 'rev-3',
    sortOrder: 7,
    groupLabel: 'B 衣',
    name: '薄力粉',
    amount: '適量',
    note: null,
  },

  // Recipe 4: 炊き込みご飯
  {
    id: 'ing-4-01',
    revisionId: 'rev-4',
    sortOrder: 1,
    groupLabel: null,
    name: '米',
    amount: '2合',
    note: null,
  },
  {
    id: 'ing-4-02',
    revisionId: 'rev-4',
    sortOrder: 2,
    groupLabel: null,
    name: '鶏もも肉',
    amount: '150g',
    note: null,
  },
  {
    id: 'ing-4-03',
    revisionId: 'rev-4',
    sortOrder: 3,
    groupLabel: null,
    name: 'にんじん',
    amount: '½本',
    note: null,
  },
  {
    id: 'ing-4-04',
    revisionId: 'rev-4',
    sortOrder: 4,
    groupLabel: null,
    name: 'ごぼう',
    amount: '½本',
    note: null,
  },
  {
    id: 'ing-4-05',
    revisionId: 'rev-4',
    sortOrder: 5,
    groupLabel: null,
    name: '油揚げ',
    amount: '1枚',
    note: null,
  },
  {
    id: 'ing-4-06',
    revisionId: 'rev-4',
    sortOrder: 6,
    groupLabel: 'A 調味料',
    name: '醤油',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-4-07',
    revisionId: 'rev-4',
    sortOrder: 7,
    groupLabel: 'A 調味料',
    name: 'みりん',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-4-08',
    revisionId: 'rev-4',
    sortOrder: 8,
    groupLabel: 'A 調味料',
    name: '酒',
    amount: '大さじ1',
    note: null,
  },

  // Recipe 5: 豚汁
  {
    id: 'ing-5-01',
    revisionId: 'rev-5',
    sortOrder: 1,
    groupLabel: null,
    name: '豚バラ肉',
    amount: '150g',
    note: null,
  },
  {
    id: 'ing-5-02',
    revisionId: 'rev-5',
    sortOrder: 2,
    groupLabel: null,
    name: '大根',
    amount: '¼本',
    note: null,
  },
  {
    id: 'ing-5-03',
    revisionId: 'rev-5',
    sortOrder: 3,
    groupLabel: null,
    name: 'にんじん',
    amount: '½本',
    note: null,
  },
  {
    id: 'ing-5-04',
    revisionId: 'rev-5',
    sortOrder: 4,
    groupLabel: null,
    name: 'じゃがいも',
    amount: '2個',
    note: null,
  },
  {
    id: 'ing-5-05',
    revisionId: 'rev-5',
    sortOrder: 5,
    groupLabel: null,
    name: '玉ねぎ',
    amount: '1個',
    note: null,
  },
  {
    id: 'ing-5-06',
    revisionId: 'rev-5',
    sortOrder: 6,
    groupLabel: null,
    name: 'ごぼう',
    amount: '½本',
    note: null,
  },
  {
    id: 'ing-5-07',
    revisionId: 'rev-5',
    sortOrder: 7,
    groupLabel: 'A 調味料',
    name: '味噌',
    amount: '大さじ3',
    note: null,
  },
  {
    id: 'ing-5-08',
    revisionId: 'rev-5',
    sortOrder: 8,
    groupLabel: 'A 調味料',
    name: 'だし汁',
    amount: '800ml',
    note: null,
  },

  // Recipe 6: ハンバーグ
  {
    id: 'ing-6-01',
    revisionId: 'rev-6',
    sortOrder: 1,
    groupLabel: null,
    name: '合い挽き肉',
    amount: '300g',
    note: null,
  },
  {
    id: 'ing-6-02',
    revisionId: 'rev-6',
    sortOrder: 2,
    groupLabel: null,
    name: '玉ねぎ',
    amount: '½個',
    note: null,
  },
  {
    id: 'ing-6-03',
    revisionId: 'rev-6',
    sortOrder: 3,
    groupLabel: null,
    name: '卵',
    amount: '1個',
    note: null,
  },
  {
    id: 'ing-6-04',
    revisionId: 'rev-6',
    sortOrder: 4,
    groupLabel: null,
    name: 'パン粉',
    amount: '大さじ3',
    note: null,
  },
  {
    id: 'ing-6-05',
    revisionId: 'rev-6',
    sortOrder: 5,
    groupLabel: null,
    name: '牛乳',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-6-06',
    revisionId: 'rev-6',
    sortOrder: 6,
    groupLabel: 'A ソース',
    name: 'ウスターソース',
    amount: '大さじ2',
    note: null,
  },
  {
    id: 'ing-6-07',
    revisionId: 'rev-6',
    sortOrder: 7,
    groupLabel: 'A ソース',
    name: 'ケチャップ',
    amount: '大さじ2',
    note: null,
  },
] as const;

// ─── Steps ──────────────────────────────────────────────────────────────────
export const seedSteps = [
  // Recipe 1: 肉じゃが
  {
    id: 'step-1-01',
    revisionId: 'rev-1',
    sortOrder: 1,
    body: 'じゃがいもは皮をむき一口大に切る。水にさらしてアクを抜く。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-1-02',
    revisionId: 'rev-1',
    sortOrder: 2,
    body: '玉ねぎはくし形に、にんじんは乱切りにする。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-1-03',
    revisionId: 'rev-1',
    sortOrder: 3,
    body: '鍋に油を熱し牛肉を炒める。色が変わったら野菜を加えて炒める。',
    timerSec: 180,
    photoId: null,
  },
  {
    id: 'step-1-04',
    revisionId: 'rev-1',
    sortOrder: 4,
    body: 'Aの調味料とだし汁を加え、落し蓋をして中火で煮る。',
    timerSec: 900,
    photoId: null,
  },
  {
    id: 'step-1-05',
    revisionId: 'rev-1',
    sortOrder: 5,
    body: 'じゃがいもに竹串がすっと通れば完成。器に盛り付ける。',
    timerSec: null,
    photoId: null,
  },

  // Recipe 2: 味噌汁
  {
    id: 'step-2-01',
    revisionId: 'rev-2',
    sortOrder: 1,
    body: '鍋にだし汁を入れて火にかける。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-2-02',
    revisionId: 'rev-2',
    sortOrder: 2,
    body: '玉ねぎを薄切りにして鍋に入れ、柔らかくなるまで煮る。',
    timerSec: 180,
    photoId: null,
  },
  {
    id: 'step-2-03',
    revisionId: 'rev-2',
    sortOrder: 3,
    body: '豆腐をさいの目に切って加える。わかめも加える。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-2-04',
    revisionId: 'rev-2',
    sortOrder: 4,
    body: '火を弱め、味噌を溶き入れる。沸騰させずに火を止める。',
    timerSec: null,
    photoId: null,
  },

  // Recipe 3: 唐揚げ
  {
    id: 'step-3-01',
    revisionId: 'rev-3',
    sortOrder: 1,
    body: '鶏もも肉を一口大に切る。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-3-02',
    revisionId: 'rev-3',
    sortOrder: 2,
    body: 'Aの下味の材料を合わせ、鶏肉を漬け込む。',
    timerSec: 900,
    photoId: null,
  },
  {
    id: 'step-3-03',
    revisionId: 'rev-3',
    sortOrder: 3,
    body: '片栗粉と薄力粉を混ぜ、鶏肉にまぶす。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-3-04',
    revisionId: 'rev-3',
    sortOrder: 4,
    body: '170℃の油で3〜4分揚げる。一度取り出して2分休ませる。',
    timerSec: 240,
    photoId: null,
  },
  {
    id: 'step-3-05',
    revisionId: 'rev-3',
    sortOrder: 5,
    body: '190℃に上げて1分揚げ、カリッと仕上げる。',
    timerSec: 60,
    photoId: null,
  },

  // Recipe 4: 炊き込みご飯
  {
    id: 'step-4-01',
    revisionId: 'rev-4',
    sortOrder: 1,
    body: '米を研いで30分浸水させる。',
    timerSec: 1800,
    photoId: null,
  },
  {
    id: 'step-4-02',
    revisionId: 'rev-4',
    sortOrder: 2,
    body: '鶏肉は小さめに切る。にんじん・ごぼうは細切り、油揚げは短冊切りにする。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-4-03',
    revisionId: 'rev-4',
    sortOrder: 3,
    body: '炊飯器に米とAの調味料を入れ、2合の線まで水を加える。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-4-04',
    revisionId: 'rev-4',
    sortOrder: 4,
    body: '具材を米の上にのせ（混ぜない）、炊飯する。',
    timerSec: 2700,
    photoId: null,
  },
  {
    id: 'step-4-05',
    revisionId: 'rev-4',
    sortOrder: 5,
    body: '炊き上がったら全体をさっくり混ぜ、器に盛る。',
    timerSec: null,
    photoId: null,
  },

  // Recipe 5: 豚汁
  {
    id: 'step-5-01',
    revisionId: 'rev-5',
    sortOrder: 1,
    body: '野菜をすべて食べやすい大きさに切る。豚肉は一口大に切る。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-5-02',
    revisionId: 'rev-5',
    sortOrder: 2,
    body: '鍋にごま油を熱し、豚肉を炒める。野菜を加えてさらに炒める。',
    timerSec: 180,
    photoId: null,
  },
  {
    id: 'step-5-03',
    revisionId: 'rev-5',
    sortOrder: 3,
    body: 'だし汁を加え、アクを取りながら野菜が柔らかくなるまで煮る。',
    timerSec: 600,
    photoId: null,
  },
  {
    id: 'step-5-04',
    revisionId: 'rev-5',
    sortOrder: 4,
    body: '火を弱め、味噌を溶き入れて完成。',
    timerSec: null,
    photoId: null,
  },

  // Recipe 6: ハンバーグ
  {
    id: 'step-6-01',
    revisionId: 'rev-6',
    sortOrder: 1,
    body: '玉ねぎをみじん切りにし、バターで透明になるまで炒めて冷ます。',
    timerSec: 300,
    photoId: null,
  },
  {
    id: 'step-6-02',
    revisionId: 'rev-6',
    sortOrder: 2,
    body: 'ボウルにひき肉、炒めた玉ねぎ、卵、パン粉、牛乳を入れてよくこねる。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-6-03',
    revisionId: 'rev-6',
    sortOrder: 3,
    body: '4等分にして小判形に成形する。中央をへこませる。',
    timerSec: null,
    photoId: null,
  },
  {
    id: 'step-6-04',
    revisionId: 'rev-6',
    sortOrder: 4,
    body: 'フライパンを中火で熱し、両面に焼き色をつける。蓋をして弱火で5分蒸し焼きにする。',
    timerSec: 300,
    photoId: null,
  },
  {
    id: 'step-6-05',
    revisionId: 'rev-6',
    sortOrder: 5,
    body: 'Aのソースの材料を合わせてフライパンで煮詰め、ハンバーグにかける。',
    timerSec: 120,
    photoId: null,
  },
] as const;

// ─── Tags ───────────────────────────────────────────────────────────────────
export const seedTags = [
  { id: 'tag-01', familyId: FAMILY_ID, name: '肉', color: null },
  { id: 'tag-02', familyId: FAMILY_ID, name: '煮物', color: null },
  { id: 'tag-03', familyId: FAMILY_ID, name: '定番', color: null },
  { id: 'tag-04', familyId: FAMILY_ID, name: '汁物', color: null },
  { id: 'tag-05', familyId: FAMILY_ID, name: '揚げ物', color: null },
  { id: 'tag-06', familyId: FAMILY_ID, name: 'ご飯', color: null },
  { id: 'tag-07', familyId: FAMILY_ID, name: '秋', color: null },
  { id: 'tag-08', familyId: FAMILY_ID, name: '冬', color: null },
  { id: 'tag-09', familyId: FAMILY_ID, name: '洋食', color: null },
] as const;

// ─── RecipeTags ─────────────────────────────────────────────────────────────
export const seedRecipeTags = [
  // 肉じゃが: 肉, 煮物, 定番
  { recipeId: 'recipe-1', tagId: 'tag-01' },
  { recipeId: 'recipe-1', tagId: 'tag-02' },
  { recipeId: 'recipe-1', tagId: 'tag-03' },
  // 味噌汁: 汁物, 定番
  { recipeId: 'recipe-2', tagId: 'tag-04' },
  { recipeId: 'recipe-2', tagId: 'tag-03' },
  // 唐揚げ: 肉, 揚げ物
  { recipeId: 'recipe-3', tagId: 'tag-01' },
  { recipeId: 'recipe-3', tagId: 'tag-05' },
  // 炊き込みご飯: ご飯, 秋
  { recipeId: 'recipe-4', tagId: 'tag-06' },
  { recipeId: 'recipe-4', tagId: 'tag-07' },
  // 豚汁: 汁物, 冬
  { recipeId: 'recipe-5', tagId: 'tag-04' },
  { recipeId: 'recipe-5', tagId: 'tag-08' },
  // ハンバーグ: 肉, 洋食
  { recipeId: 'recipe-6', tagId: 'tag-01' },
  { recipeId: 'recipe-6', tagId: 'tag-09' },
] as const;

// ─── CookingLogs ────────────────────────────────────────────────────────────
export const seedCookingLogs = [
  {
    id: 'log-1',
    familyId: FAMILY_ID,
    recipeId: 'recipe-1',
    revisionId: 'rev-1',
    cookedBy: USER_KEI,
    cookedAt: '2024-05-04T18:30:00.000Z',
    servings: 4,
    rating: 4,
    memo: 'だしを多めにした。次回も同じで◎',
    createdAt: '2024-05-04T19:00:00.000Z',
  },
  {
    id: 'log-2',
    familyId: FAMILY_ID,
    recipeId: 'recipe-2',
    revisionId: 'rev-2',
    cookedBy: USER_KEN,
    cookedAt: '2024-05-03T18:00:00.000Z',
    servings: 4,
    rating: 5,
    memo: null,
    createdAt: '2024-05-03T18:30:00.000Z',
  },
  {
    id: 'log-3',
    familyId: FAMILY_ID,
    recipeId: 'recipe-3',
    revisionId: 'rev-3',
    cookedBy: USER_KEI,
    cookedAt: '2024-04-28T18:00:00.000Z',
    servings: 4,
    rating: 5,
    memo: 'ニンニク多めで大好評！',
    createdAt: '2024-04-28T18:30:00.000Z',
  },
  {
    id: 'log-4',
    familyId: FAMILY_ID,
    recipeId: 'recipe-4',
    revisionId: 'rev-4',
    cookedBy: USER_YO,
    cookedAt: '2024-04-20T12:00:00.000Z',
    servings: 4,
    rating: 4,
    memo: null,
    createdAt: '2024-04-20T12:30:00.000Z',
  },
] as const;

// ─── CookingPhotos ──────────────────────────────────────────────────────────
// サンプル写真は同梱しない。実在しないファイルパスを撒くとホームカードや
// レシピカバーが空枠で描画されるため（旧シードの不具合）、空にしておく。
export const seedCookingPhotos: readonly {
  id: string;
  logId: string;
  localPath: string;
  cloudUrl: string | null;
  sortOrder: number;
  takenAt: string;
  createdAt: string;
}[] = [];

// ─── Stress Test Seed Generator ─────────────────────────────────────────────

const STRESS_TITLES = [
  '焼き魚定食',
  'チキンカレー',
  'パスタナポリタン',
  'オムライス',
  '牛丼',
  '天ぷらうどん',
  '刺身盛り合わせ',
  'かつ丼',
  '麻婆豆腐',
  '餃子',
  '焼きそば',
  'お好み焼き',
  'ラーメン',
  '親子丼',
  'すき焼き',
  '手巻き寿司',
  'グラタン',
  '回鍋肉',
  'シチュー',
  'ビーフストロガノフ',
];

const STRESS_INGREDIENTS = [
  '鶏肉',
  '豚肉',
  '牛肉',
  '卵',
  '玉ねぎ',
  'にんじん',
  'キャベツ',
  'ねぎ',
  'トマト',
  'ピーマン',
  '大根',
  '白菜',
  'もやし',
  'にんにく',
  '豆腐',
  '油揚げ',
  'しめじ',
  'えのき',
  'ほうれん草',
  '塩',
  '醤油',
  '味噌',
  'みりん',
  '酒',
  '砂糖',
  'だし汁',
  'サラダ油',
  'ごま油',
];

interface StressRecipe {
  id: string;
  familyId: string;
  title: string;
  titleReading: string | null;
  currentRevId: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface StressRevision {
  id: string;
  recipeId: string;
  revisionNumber: number;
  isMajor: boolean;
  servings: number;
  cookTimeMin: number;
  prepTimeMin: number;
  description: string;
  authorNote: string | null;
  sourceId: string | null;
  createdBy: string;
  createdAt: string;
}

interface StressIngredient {
  id: string;
  revisionId: string;
  sortOrder: number;
  groupLabel: string | null;
  name: string;
  amount: string;
  note: string | null;
}

interface StressStep {
  id: string;
  revisionId: string;
  sortOrder: number;
  body: string;
  timerSec: number | null;
  photoId: string | null;
}

/**
 * Generate 300 recipes for stress testing.
 */
export function generateStressTestSeed(): {
  recipes: StressRecipe[];
  revisions: StressRevision[];
  ingredients: StressIngredient[];
  steps: StressStep[];
} {
  const recipes: StressRecipe[] = [];
  const revisions: StressRevision[] = [];
  const ings: StressIngredient[] = [];
  const stps: StressStep[] = [];

  for (let i = 0; i < 300; i++) {
    const recipeId = `stress-recipe-${i}`;
    const revId = `stress-rev-${i}`;
    const titleIdx = i % STRESS_TITLES.length;
    const title = `${STRESS_TITLES[titleIdx]} #${i + 1}`;

    recipes.push({
      id: recipeId,
      familyId: 'family-001',
      title,
      titleReading: null,
      currentRevId: revId,
      status: 'active',
      createdBy: 'user-kei',
      createdAt: `2024-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      updatedAt: `2024-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    });

    revisions.push({
      id: revId,
      recipeId,
      revisionNumber: 1,
      isMajor: true,
      servings: (i % 6) + 1,
      cookTimeMin: ((i % 12) + 1) * 5,
      prepTimeMin: ((i % 6) + 1) * 5,
      description: `テスト用レシピ #${i + 1}`,
      authorNote: null,
      sourceId: null,
      createdBy: 'user-kei',
      createdAt: `2024-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    });

    const ingCount = (i % 4) + 3;
    for (let j = 0; j < ingCount; j++) {
      const ingIdx = (i * 3 + j) % STRESS_INGREDIENTS.length;
      ings.push({
        id: `stress-ing-${i}-${j}`,
        revisionId: revId,
        sortOrder: j + 1,
        groupLabel: j >= ingCount - 2 ? 'A 調味料' : null,
        name: STRESS_INGREDIENTS[ingIdx],
        amount: '適量',
        note: null,
      });
    }

    const stepCount = (i % 3) + 3;
    for (let j = 0; j < stepCount; j++) {
      stps.push({
        id: `stress-step-${i}-${j}`,
        revisionId: revId,
        sortOrder: j + 1,
        body: `手順 ${j + 1}: テスト用の説明文です。`,
        timerSec: j === stepCount - 2 ? ((i % 5) + 1) * 60 : null,
        photoId: null,
      });
    }
  }

  return { recipes, revisions, ingredients: ings, steps: stps };
}

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
] as const;

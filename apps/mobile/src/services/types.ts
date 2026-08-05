/**
 * Service layer shared types
 * Used across all services for consistent data contracts
 */

export interface RecipeListItem {
  id: string;
  title: string;
  cookTimeMin: number | null;
  rating: number | null;
  tags: string[];
  ingredientNames: string[];
  /** ISO timestamp the recipe was created (for "newest" sort) */
  createdAt: string;
  /** Number of cooking logs recorded for this recipe (for "most cooked" sort) */
  cookCount: number;
  /** Card image: the cover photo, else the latest cooking photo, if any */
  heroPhotoUri: string | null;
}

export interface RecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  cookTimeMin: number | null;
  description: string | null;
  rating: number | null;
  tags: string[];
  ingredients: IngredientItem[];
  steps: StepItem[];
  /** Detail header image: the cover photo, else the latest cooking photo, if any */
  heroPhotoUri: string | null;
  /** The recipe's own cover photo (端末内パス) — null if none set */
  coverPhotoPath: string | null;
}

export interface MemoItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export interface RecipeRevisionSummary {
  id: string;
  recipeId: string;
  revisionNumber: number;
  isMajor: boolean;
  createdBy: string;
  createdAt: string;
  servings: number | null;
  cookTimeMin: number | null;
  prepTimeMin: number | null;
  description: string | null;
  authorNote: string | null;
  sourceId: string | null;
  ingredientCount: number;
  stepCount: number;
  isCurrent: boolean;
}

export interface IngredientItem {
  id: string;
  groupLabel: string | null;
  name: string;
  amount: string | null;
  note: string | null;
  sortOrder: number;
}

export interface StepItem {
  id: string;
  body: string;
  timerSec: number | null;
  sortOrder: number;
  /** 手順写真（端末内パス） */
  photoPath: string | null;
}

export interface TimelineEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
}

export interface CookingPhotoItem {
  id: string;
  localPath: string;
  cloudUrl: string | null;
  sortOrder: number;
  takenAt: string | null;
  createdAt: string;
}

export interface SaveRecipeInput {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  authorNote?: string;
  sourceId?: string;
  ingredients: {
    groupLabel?: string;
    name: string;
    amount?: string;
    note?: string;
  }[];
  steps: {
    body: string;
    timerSec?: number;
    /** 手順写真（端末内パス） */
    photoPath?: string | null;
  }[];
  tags: string[];
  /** 表紙写真（端末内パス）。null/undefined = なし */
  coverPhotoPath?: string | null;
}

export interface UpdateRecipeInput extends SaveRecipeInput {
  isMajor?: boolean;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
}

export type FamilyRole = 'owner' | 'member';

export interface CurrentUser {
  id: string;
  displayName: string;
}

export interface CurrentFamily {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  memberCount: number;
}

export interface FamilyMember {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: FamilyRole;
  joinedAt: string;
  isCurrentUser: boolean;
}

export interface JoinFamilyResult {
  status: 'joined' | 'already-member';
  family: CurrentFamily;
}

export interface SaveCookingLogInput {
  recipeId?: string;
  servings?: number;
  rating?: number;
  memo?: string;
  cookedAt: string;
  photos?: SaveCookingPhotoInput[];
}

export interface SaveCookingPhotoInput {
  localPath: string;
  cloudUrl?: string | null;
  takenAt?: string;
}

export interface CookingLogEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
}

export type ShoppingItemSource = 'manual' | 'recipe' | 'low_stock' | 'receipt';

export interface ShoppingItem {
  id: string;
  name: string;
  amount: string | null;
  checked: boolean;
  source: ShoppingItemSource;
  recipeId: string | null;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  lowStockThreshold: number | null;
  janCode: string | null;
}

// ─── さいえん手帳: 栽培（R01）───────────────────────────────────────────────

/** 種から / 苗から。R01 の「植え付け日(種/苗)」 */
export type PlantedAs = 'seed' | 'seedling';

/** 栽培終了の理由。R01 のアーカイブ */
export type PlantingEndedReason = 'harvested' | 'died' | 'other';

export interface PlaceItem {
  id: string;
  name: string;
  /** planter=プランター / row=畝 / plot=区画 / other */
  kind: string | null;
}

export interface PlantingListItem {
  id: string;
  cropName: string;
  variety: string | null;
  placeName: string | null;
  plantedOn: string;
  plantedAs: PlantedAs;
  /** 植え付けからの経過日数。栽培終了後は終了日までの日数 */
  elapsedDays: number;
  tags: string[];
  coverPhotoUri: string | null;
  endedAt: string | null;
  endedReason: PlantingEndedReason | null;
  /** 場所順の並べ替え用。場所未設定は末尾（R03 / WBS 1.7） */
  placeSortKey: number;
}

export interface PlantingDetail extends PlantingListItem {
  cropId: string | null;
  cropNameReading: string | null;
  placeId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavePlantingInput {
  cropName: string;
  cropNameReading?: string;
  /** 作物マスターを選んだ場合のみ。自由入力なら未指定 */
  cropId?: string | null;
  variety?: string;
  placeId?: string | null;
  /** ISO 8601 */
  plantedOn: string;
  plantedAs: PlantedAs;
  coverPhotoPath?: string | null;
  note?: string;
  tags: string[];
}

export type UpdatePlantingInput = SavePlantingInput;

// ─── さいえん手帳: 場所（R02 / WBS 1.6）────────────────────────────────────

export interface PlaceDetail extends PlaceItem {
  note: string | null;
  sortOrder: number | null;
  archivedAt: string | null;
  /** この場所で育てた栽培の総数（終了分を含む） */
  plantingCount: number;
  /** うち育成中 */
  growingCount: number;
}

export interface SavePlaceInput {
  name: string;
  /** planter=プランター / row=畝 / plot=区画 / other */
  kind: string;
  note?: string;
}

// ─── さいえん手帳: 作業ログ（R04 / WBS 1.8）────────────────────────────────

/** water=水やり / fertilize=追肥 / transplant=植え替え / prune=剪定 / pest=防除 / other */
export type CareLogKind = 'water' | 'fertilize' | 'transplant' | 'prune' | 'pest' | 'other';

export interface CareLogItem {
  id: string;
  plantingId: string;
  kind: CareLogKind;
  loggedAt: string;
  note: string | null;
  /** 端末内の写真パス。最大 6 枚（R04） */
  photoUris: string[];
}

export interface SaveCareLogInput {
  plantingId: string;
  kind: CareLogKind;
  /** 未指定なら「今」（R04 の日時自動設定） */
  loggedAt?: string;
  note?: string;
  photoUris?: string[];
}

// ─── さいえん手帳: タイムライン（R05 / WBS 1.9）────────────────────────────

/**
 * タイムラインの 1 行。
 * 収穫（WBS 2.1）が合流したときに type で区別できるようにしてある。
 */
export interface GardenTimelineEntry {
  id: string;
  type: 'care_log' | 'harvest';
  plantingId: string;
  cropName: string;
  variety: string | null;
  /** 作業ログのときだけ入る */
  kind: CareLogKind | null;
  /** 収穫のときだけ入りうる（数量は任意 — R06） */
  quantity: number | null;
  unit: HarvestUnit | null;
  loggedAt: string;
  note: string | null;
  photoUris: string[];
}

// ─── さいえん手帳: 収穫（R06 / WBS 2.1）────────────────────────────────────

/** piece=個 / g / kg / bunch=束 / plant=株 */
export type HarvestUnit = 'piece' | 'g' | 'kg' | 'bunch' | 'plant';

export interface HarvestItem {
  id: string;
  plantingId: string;
  harvestedAt: string;
  /** 任意入力（R06）。写真だけでも成立する */
  quantity: number | null;
  unit: HarvestUnit | null;
  note: string | null;
  photoUris: string[];
}

export interface SaveHarvestInput {
  plantingId: string;
  /** 未指定なら「今」 */
  harvestedAt?: string;
  quantity?: number | null;
  unit?: HarvestUnit | null;
  note?: string;
  photoUris?: string[];
}

/** 単位ごとの合計。単位が混ざる（個と g）ので 1 つの数にまとめられない */
export interface HarvestTotal {
  unit: HarvestUnit;
  quantity: number;
}

// ─── さいえん手帳: 収穫アルバム（R07 / WBS 2.2）────────────────────────────

/**
 * アルバムの 1 マス。
 *
 * **収穫 1 件ではなく写真 1 枚が 1 マス**。1 回の収穫で複数枚撮ったとき、
 * 1 枚しか見えないとアルバムとして意味を成さない。
 * 写真の無い収穫も 1 マスとして出す（photoUri が null）。
 * 写真だけを並べると、数量だけ記録した収穫が一覧から消えてしまう。
 */
export interface HarvestPhotoCell {
  /** 写真ごとに一意。同じ収穫の 2 枚目以降も区別できる */
  key: string;
  harvestId: string;
  plantingId: string;
  cropName: string;
  harvestedAt: string;
  quantity: number | null;
  unit: HarvestUnit | null;
  photoUri: string | null;
}

export interface HarvestMonth {
  /** YYYY-MM（端末のタイムゾーン） */
  month: string;
  cells: HarvestPhotoCell[];
}

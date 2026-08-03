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

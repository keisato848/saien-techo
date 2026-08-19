/**
 * 収穫写真の読み取り（「写真から記録」— #143 / #144）。
 *
 * 採れた野菜の写真をサーバー（/garden/harvest）へ送り、作物と個数の
 * **下書き**を作る。UI では AI と名乗らない（#143 決定）。
 *
 * ## 設計の根幹
 *
 * - **記録そのものは常に無料。** 読み取れなくても収穫記録と写真は保存済みで、
 *   数量が空なだけ。この前提が崩れる実装をしないこと
 * - **順序の不変条件（#144）**: サーバーへ送ってよいのは
 *   (a) 無料枠（`usage.service` の共用日次カウンタ・その日の初回）か
 *   (b) リワード視聴完了（`rewarded === true`）で付いた `paid` 印
 *   のどちらかだけ。**楽観的に先へ送らない** — 広告が見られなかったときに
 *   リクエストが 1 本も出ないことをテストが見張る
 * - **数えられないものは数えない。** サーバーが count を返さないことがあるのは
 *   正常系（束・山盛り・株に付いたまま等）。空のまま返して手入力に任せる
 *
 * ## 状態遷移（harvest_photo_reads.state）
 *
 *   pending →(読み取り成功)→ analyzed →(記録する)→ applied
 *                                     →(しない)→ dismissed
 *          →(MAX_ATTEMPTS 回失敗)→ failed
 *   手で数量を入れたら → dismissed（キューから消える）
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import { getDb, isNativePlatform } from '../db/client';
import { API_V1 } from '../config';
import { getFreemiumStatus, incrementDailyUsage } from './usage.service';
import { expoUploadImageAdapter, type UploadImageAdapter } from './upload-image';

// ─── 定数（#144 で決定） ─────────────────────────────────────────────────────

/** リワード 1 本で読み取る枚数。10 × ¥0.07 = ¥0.7/本 で収益(¥1〜3)に margin が残る */
export const READS_PER_REWARD = 10;
/** 同一写真の再試行上限。超えたら failed に落として手入力を案内する */
export const MAX_READ_ATTEMPTS = 3;
/** まとめて読み取りの並列数 */
export const READ_CONCURRENCY = 4;
/** アプリ側の待ち時間。サーバーのリトライ予算(50.5s)より長いこと */
const TIMEOUT_MS = 60_000;

// ─── 型 ──────────────────────────────────────────────────────────────────────

export type HarvestReadState = 'pending' | 'analyzed' | 'applied' | 'dismissed' | 'failed';

export interface HarvestReadResult {
  isHarvest: boolean;
  cropGuess?: string;
  cropConfidence?: 'high' | 'medium' | 'low';
  count?: number;
  countConfidence?: 'high' | 'medium' | 'low';
  note?: string;
}

/** 読み取りキューの 1 行（画面表示用に収穫・栽培の情報を結合済み） */
export interface HarvestReadItem {
  harvestId: string;
  plantingId: string;
  cropName: string;
  harvestedAt: string;
  photoUri: string | null;
  state: HarvestReadState;
  paid: boolean;
  attempts: number;
  cropGuess: string | null;
  count: number | null;
  readNote: string | null;
}

export type HarvestReadErrorKind = 'quota' | 'network' | 'server' | 'image';

export class HarvestReadError extends Error {
  readonly kind: HarvestReadErrorKind;
  constructor(message: string, kind: HarvestReadErrorKind) {
    super(message);
    this.name = 'HarvestReadError';
    this.kind = kind;
  }
}

// ─── サーバー呼び出し ────────────────────────────────────────────────────────

interface ServerEnvelope {
  ok: boolean;
  data?: HarvestReadResult;
  error?: { code?: string; message?: string; retryable?: boolean };
}

/**
 * 写真 1 枚を読み取る（低レベル）。**枠の判定はしない** — 呼び出し側が
 * 無料枠か paid 印で通行権を確認してから呼ぶこと。
 */
export async function requestHarvestRead(
  imageUri: string,
  cropName: string | undefined,
  imageAdapter: UploadImageAdapter = expoUploadImageAdapter,
  fetchFn: typeof fetch = fetch,
): Promise<HarvestReadResult> {
  let prepared: { base64: string; mimeType: string };
  try {
    prepared = await imageAdapter.prepare(imageUri);
  } catch {
    throw new HarvestReadError('写真を読み込めませんでした', 'image');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${API_V1}/garden/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: prepared.base64,
        mimeType: prepared.mimeType,
        ...(cropName ? { cropName: cropName.slice(0, 50) } : {}),
        locale: 'ja',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HarvestReadError(`サーバーエラーが発生しました（${res.status}）`, 'server');
    }
    const envelope = (await res.json()) as ServerEnvelope;
    if (!envelope.ok || !envelope.data) {
      throw new HarvestReadError(
        envelope.error?.message ?? '写真を読み取れませんでした。数量は手で入力できます。',
        'server',
      );
    }
    return envelope.data;
  } catch (err) {
    if (err instanceof HarvestReadError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HarvestReadError('時間内に応答がありませんでした。', 'network');
    }
    throw new HarvestReadError('通信できませんでした。', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * フォーム内の直接読み取り（保存前・レコード未作成）。
 * **無料枠を通ってから**サーバーへ送る。成功（収穫物が写っていた）ときだけ
 * 枠を消費する — 撮り損じで 1 日 1 回の枠が飛ぶのは理不尽（AI 相談と同じ扱い）。
 */
export async function readPhotoDirect(
  imageUri: string,
  cropName: string | undefined,
  deps?: { imageAdapter?: UploadImageAdapter; fetchFn?: typeof fetch },
): Promise<HarvestReadResult> {
  const status = await getFreemiumStatus();
  if (!status.canInfer) {
    throw new HarvestReadError(
      '今日の読み取りぶんは使い切りました。保存しておくと、あとで「まとめて読み取る」から読めます。',
      'quota',
    );
  }
  const data = await requestHarvestRead(imageUri, cropName, deps?.imageAdapter, deps?.fetchFn);
  if (data.isHarvest) {
    await incrementDailyUsage();
  }
  return data;
}

// ─── キュー管理 ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 収穫レコードを読み取り待ちに積む。
 * 写真があり、数量が空のときだけ（数量が入っているなら読むものがない）。
 * `createHarvest` から呼ばれる。
 */
export async function enqueueHarvestRead(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;
  const db = getDb();
  const now = nowIso();
  await db
    .insert(schema.harvestPhotoReads)
    .values({ harvestId, state: 'pending', paid: 0, attempts: 0, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

/** 手で数量を入れた収穫の読み取りを取り下げる（`updateHarvest` から） */
export async function dismissReadForManualQuantity(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;
  const db = getDb();
  await db
    .update(schema.harvestPhotoReads)
    .set({ state: 'dismissed', updatedAt: nowIso() })
    .where(
      and(
        eq(schema.harvestPhotoReads.harvestId, harvestId),
        inArray(schema.harvestPhotoReads.state, ['pending', 'analyzed', 'failed']),
      ),
    );
}

/** 収穫の削除に追従する（`deleteHarvest` から） */
export async function deleteReadForHarvest(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;
  const db = getDb();
  await db
    .delete(schema.harvestPhotoReads)
    .where(eq(schema.harvestPhotoReads.harvestId, harvestId));
}

/** ホーム・収穫タブのカード用。読み取り待ち（pending）と確認待ち（analyzed）の数 */
export async function getOpenReadCount(): Promise<number> {
  if (!isNativePlatform) return 0;
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.harvestPhotoReads)
    .where(inArray(schema.harvestPhotoReads.state, ['pending', 'analyzed']));
  return rows[0]?.n ?? 0;
}

/** 読み取り画面の一覧。古い順（先に撮ったものから読む） */
export async function getReadQueue(): Promise<HarvestReadItem[]> {
  if (!isNativePlatform) return [];
  const db = getDb();
  const rows = await db
    .select({
      harvestId: schema.harvestPhotoReads.harvestId,
      state: schema.harvestPhotoReads.state,
      paid: schema.harvestPhotoReads.paid,
      attempts: schema.harvestPhotoReads.attempts,
      cropGuess: schema.harvestPhotoReads.cropGuess,
      count: schema.harvestPhotoReads.count,
      readNote: schema.harvestPhotoReads.readNote,
      plantingId: schema.harvests.plantingId,
      harvestedAt: schema.harvests.harvestedAt,
      cropName: schema.plantings.cropName,
    })
    .from(schema.harvestPhotoReads)
    .innerJoin(schema.harvests, eq(schema.harvests.id, schema.harvestPhotoReads.harvestId))
    .innerJoin(schema.plantings, eq(schema.plantings.id, schema.harvests.plantingId))
    .where(inArray(schema.harvestPhotoReads.state, ['pending', 'analyzed', 'failed']))
    .orderBy(asc(schema.harvestPhotoReads.createdAt));

  if (rows.length === 0) return [];

  const photoRows = await db
    .select({
      ownerId: schema.photos.ownerId,
      localPath: schema.photos.localPath,
      sortOrder: schema.photos.sortOrder,
    })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.ownerType, 'harvest'),
        inArray(
          schema.photos.ownerId,
          rows.map((row) => row.harvestId),
        ),
      ),
    )
    .orderBy(asc(schema.photos.sortOrder));
  const firstPhoto = new Map<string, string>();
  for (const photo of photoRows) {
    if (!firstPhoto.has(photo.ownerId)) firstPhoto.set(photo.ownerId, photo.localPath);
  }

  return rows.map((row) => ({
    harvestId: row.harvestId,
    plantingId: row.plantingId,
    cropName: row.cropName,
    harvestedAt: row.harvestedAt,
    photoUri: firstPhoto.get(row.harvestId) ?? null,
    state: row.state as HarvestReadState,
    paid: row.paid === 1,
    attempts: row.attempts,
    cropGuess: row.cropGuess,
    count: row.count,
    readNote: row.readNote,
  }));
}

// ─── 通行権（無料枠 / リワード） ─────────────────────────────────────────────

/**
 * リワード視聴完了ぶんの paid 印を付ける。**`rewarded === true` を確認してから
 * 呼ぶこと**（呼び出し側の責務。ここでは広告の状態を見ない）。
 * 古い順に最大 `READS_PER_REWARD` 枚。印を付けた harvestId を返す。
 */
export async function markPaidForReward(): Promise<string[]> {
  if (!isNativePlatform) return [];
  const db = getDb();
  const targets = await db
    .select({ harvestId: schema.harvestPhotoReads.harvestId })
    .from(schema.harvestPhotoReads)
    .where(and(eq(schema.harvestPhotoReads.state, 'pending'), eq(schema.harvestPhotoReads.paid, 0)))
    .orderBy(asc(schema.harvestPhotoReads.createdAt))
    .limit(READS_PER_REWARD);
  const ids = targets.map((row) => row.harvestId);
  if (ids.length === 0) return [];
  await db
    .update(schema.harvestPhotoReads)
    .set({ paid: 1, updatedAt: nowIso() })
    .where(inArray(schema.harvestPhotoReads.harvestId, ids));
  return ids;
}

/**
 * 無料枠（その日の初回）で先頭の 1 枚に paid 印を付ける。
 * 枠が無い・待ちが無いときは null。**枠の消費は読み取り成功時**（processPaidReads 内）。
 */
export async function grantFreeRead(): Promise<string | null> {
  if (!isNativePlatform) return null;
  const status = await getFreemiumStatus();
  if (!status.canInfer) return null;
  const db = getDb();
  const target = await db
    .select({ harvestId: schema.harvestPhotoReads.harvestId })
    .from(schema.harvestPhotoReads)
    .where(and(eq(schema.harvestPhotoReads.state, 'pending'), eq(schema.harvestPhotoReads.paid, 0)))
    .orderBy(asc(schema.harvestPhotoReads.createdAt))
    .limit(1);
  const harvestId = target[0]?.harvestId;
  if (!harvestId) return null;
  await db
    .update(schema.harvestPhotoReads)
    .set({ paid: 1, updatedAt: nowIso() })
    .where(eq(schema.harvestPhotoReads.harvestId, harvestId));
  // 無料枠ぶんは共用の日次カウンタを 1 消費する（キーは AI 相談と共用 — #144 決定）。
  // paid 印を付けた時点で消費する — 成功時消費にすると、途中でアプリを閉じて
  // 再開するたびに「無料のまま何度でも」になってしまう（印は残るため）。
  await incrementDailyUsage();
  return harvestId;
}

// ─── まとめて読み取り（paid のものだけ処理） ────────────────────────────────

export interface ProcessProgress {
  done: number;
  total: number;
  item: HarvestReadItem;
}

/**
 * paid 印のついた読み取り待ちを、古い順に並列 `READ_CONCURRENCY` で処理する。
 * **paid=0 のものには絶対に触らない**（順序の不変条件 — テストが見張る）。
 *
 * 失敗は attempts を進めるだけで pending(paid) のまま残し、次回に自動で再開する
 * （リワードの履行 — 約束した枚数は広告なしで果たす）。`MAX_READ_ATTEMPTS` 回
 * 失敗したら failed に落として手入力を案内する。
 */
export async function processPaidReads(
  onProgress?: (progress: ProcessProgress) => void,
  deps?: { imageAdapter?: UploadImageAdapter; fetchFn?: typeof fetch },
): Promise<{ processed: number; failed: number }> {
  if (!isNativePlatform) return { processed: 0, failed: 0 };
  const queue = (await getReadQueue()).filter((item) => item.state === 'pending' && item.paid);
  if (queue.length === 0) return { processed: 0, failed: 0 };

  const db = getDb();
  let processed = 0;
  let failed = 0;
  let index = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const current = queue[index++];
      if (!current) return;

      const attempts = current.attempts + 1;
      try {
        const data = await requestHarvestRead(
          current.photoUri ?? '',
          current.cropName,
          deps?.imageAdapter,
          deps?.fetchFn,
        );
        const note = data.isHarvest
          ? (data.note ?? null)
          : (data.note ?? '収穫物が写っていないようです。採ったあとの写真だと読み取れます。');
        await db
          .update(schema.harvestPhotoReads)
          .set({
            state: 'analyzed',
            attempts,
            cropGuess: data.cropGuess ?? null,
            cropConfidence: data.cropConfidence ?? null,
            count: data.isHarvest && data.count != null ? data.count : null,
            countConfidence: data.countConfidence ?? null,
            readNote: note,
            updatedAt: nowIso(),
          })
          .where(eq(schema.harvestPhotoReads.harvestId, current.harvestId));
        processed += 1;
        onProgress?.({
          done: processed + failed,
          total: queue.length,
          item: { ...current, state: 'analyzed', attempts, count: data.count ?? null },
        });
      } catch {
        const isFinal = attempts >= MAX_READ_ATTEMPTS;
        await db
          .update(schema.harvestPhotoReads)
          .set({
            state: isFinal ? 'failed' : 'pending',
            attempts,
            readNote: isFinal ? '読み取れませんでした。数量は手で入力できます。' : null,
            updatedAt: nowIso(),
          })
          .where(eq(schema.harvestPhotoReads.harvestId, current.harvestId));
        failed += 1;
        onProgress?.({
          done: processed + failed,
          total: queue.length,
          item: { ...current, state: isFinal ? 'failed' : 'pending', attempts },
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, () => worker()),
  );
  return { processed, failed };
}

// ─── 確認（下書き → 台帳へ） ─────────────────────────────────────────────────

/**
 * 読み取り結果を収穫レコードへ書き込む（「合っていますか？ → 記録する」）。
 * count の無い結果には適用できない。単位が未設定なら「個」を入れる
 * （count は個数なので）。既に単位があるなら尊重する。
 */
export async function applyRead(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;
  const db = getDb();
  const rows = await db
    .select({ count: schema.harvestPhotoReads.count, state: schema.harvestPhotoReads.state })
    .from(schema.harvestPhotoReads)
    .where(eq(schema.harvestPhotoReads.harvestId, harvestId));
  const row = rows[0];
  if (!row || row.state !== 'analyzed' || row.count == null) return;

  await db
    .update(schema.harvests)
    .set({
      quantity: row.count,
      unit: sql`COALESCE(${schema.harvests.unit}, 'piece')`,
      updatedAt: nowIso(),
    })
    .where(eq(schema.harvests.id, harvestId));
  await db
    .update(schema.harvestPhotoReads)
    .set({ state: 'applied', updatedAt: nowIso() })
    .where(eq(schema.harvestPhotoReads.harvestId, harvestId));
}

/** 読み取りを使わない（「しない」）。記録はそのまま、キューから消えるだけ */
export async function dismissRead(harvestId: string): Promise<void> {
  if (!isNativePlatform) return;
  const db = getDb();
  await db
    .update(schema.harvestPhotoReads)
    .set({ state: 'dismissed', updatedAt: nowIso() })
    .where(eq(schema.harvestPhotoReads.harvestId, harvestId));
}

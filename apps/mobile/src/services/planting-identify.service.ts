/**
 * 写真から栽培を登録する（WBS 4.15 / #139・一括は #149）。
 *
 * 苗のラベル・種袋、または育っている株の写真をサーバーへ送り、
 * **栽培登録の下書き**（作物名・品種）を作る。サーバーは
 * `/api/v1/garden/identify`（だいどこ Railway 共用・決定⑨）。
 *
 * ## 既存の 2 本は流用できない（実測・2026-08-22）
 *
 * `/garden/consult` は模擬種袋に **`{"isPlant": false}` だけ**を返し、作物名も品種も
 * 取れなかった。`/garden/harvest` は育っている株を弾く（#149 に記録）。
 * **登録は「まだ何も無い状態」から始まる導線なので、弾かれては始まらない。**
 *
 * ## 写真は保存しない
 *
 * #149 が最大の障害として挙げた**バックアップの肥大**（年 1800 枚・360〜720MB）は、
 * 「今日の様子」を写真として残す案の話。**登録はフォームを埋めたら写真は用済み**なので、
 * ここでは一時ファイルのまま捨てる。カバー写真にしたいときはユーザーが明示的に選ぶ。
 *
 * ## 枠は相談・収穫と共有しない
 *
 * 登録は**インストール直後に集中し、その後ほとんど呼ばれない**。
 * `usage.service`（生涯 1 回の無料 + 日次ボーナス）に混ぜると、初回の一括登録で
 * 使い切って相談ができなくなる。ここは**リワード視聴で得た回数だけ**を使う
 * （`identify-credit.service`）。無料枠は消費しない。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { API_V1 } from '../config';

/** アップロード前の縮小長辺（px）。相談と揃える */
export const IDENTIFY_UPLOAD_MAX_DIMENSION = 1024;
const UPLOAD_JPEG_QUALITY = 0.7;
const TIMEOUT_MS = 60_000;

export type IdentifyConfidence = 'high' | 'medium' | 'low';
/** ラベル（種袋・苗札）か、育っている株か。サーバーが判定して返す */
export type IdentifySource = 'label' | 'plant';

/** サーバー（identify-vision.ts）の IdentifyVisionRaw と同じ形 */
export interface PlantingIdentifyResult {
  found: boolean;
  source?: IdentifySource;
  cropGuess?: string;
  cropConfidence?: IdentifyConfidence;
  /** **ラベルを読めたときだけ返る。** 株の外見からは決まらない */
  variety?: string;
  plantedAs?: 'seed' | 'seedling';
  note?: string;
}

export type IdentifyErrorKind = 'offline' | 'transient' | 'rate_limited' | 'unavailable';

export class PlantingIdentifyError extends Error {
  readonly retryable: boolean;
  readonly kind: IdentifyErrorKind;
  constructor(message: string, retryable: boolean, kind: IdentifyErrorKind = 'transient') {
    super(message);
    this.name = 'PlantingIdentifyError';
    this.retryable = retryable;
    this.kind = kind;
  }
}

interface ServerEnvelope {
  ok: boolean;
  data?: PlantingIdentifyResult;
  error?: { code?: string; message?: string; retryable?: boolean };
}

function kindFromCode(code: string | undefined): IdentifyErrorKind {
  if (code === 'RATE_LIMITED') return 'rate_limited';
  if (code === 'AI_API_UNAVAILABLE') return 'unavailable';
  return 'transient';
}

export interface IdentifyImageAdapter {
  prepare: (uri: string) => Promise<{ base64: string; mimeType: string }>;
}

const expoIdentifyImageAdapter: IdentifyImageAdapter = {
  async prepare(uri) {
    // 原寸のカメラ写真をそのまま base64 にすると数 MB に膨らむ。
    // 長辺 1024px へ縮小（ラベルの文字を読むにも十分・相談と同じ扱い）。
    let sendUri = uri;
    try {
      const context = ImageManipulator.manipulate(uri);
      const original = await context.renderAsync();
      if (Math.max(original.width, original.height) > IDENTIFY_UPLOAD_MAX_DIMENSION) {
        context.resize(
          original.width >= original.height
            ? { width: IDENTIFY_UPLOAD_MAX_DIMENSION }
            : { height: IDENTIFY_UPLOAD_MAX_DIMENSION },
        );
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: UPLOAD_JPEG_QUALITY,
      });
      sendUri = saved.uri;
    } catch {
      // 縮小できない形式は原本のまま送る（サーバー側にサイズ上限がある）
    }
    const base64 = await FileSystem.readAsStringAsync(sendUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64, mimeType: 'image/jpeg' };
  },
};

/** サーバーへ渡す作物マスターの上限（サーバー側の zod と揃える） */
const MAX_KNOWN_CROPS = 40;

export interface IdentifyArgs {
  /** 端末内の写真パス（一時ファイルでよい — 登録は写真を保存しない） */
  imageUri: string;
  /**
   * 端末の作物マスター名。**表記ゆれを抑える手がかり。**
   * これを渡すと「エダマメ（大豆）」ではなく一覧どおりの「エダマメ」で返る。
   */
  knownCrops?: string[];
}

/**
 * 写真を縮小して送り、栽培登録の下書きを返す。
 * 失敗は必ず PlantingIdentifyError で投げる（画面はメッセージを出すだけでよい）。
 */
export async function identifyPlanting(
  args: IdentifyArgs,
  imageAdapter: IdentifyImageAdapter = expoIdentifyImageAdapter,
  fetchFn: typeof fetch = fetch,
): Promise<PlantingIdentifyResult> {
  let base64: string;
  let mimeType: string;
  try {
    ({ base64, mimeType } = await imageAdapter.prepare(args.imageUri));
  } catch {
    throw new PlantingIdentifyError('写真を読み込めませんでした', false);
  }

  const knownCrops = (args.knownCrops ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, MAX_KNOWN_CROPS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${API_V1}/garden/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType,
        ...(knownCrops.length > 0 ? { knownCrops } : {}),
        locale: 'ja',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new PlantingIdentifyError(
        `サーバーエラーが発生しました（${res.status}）`,
        res.status >= 500,
      );
    }

    const envelope = (await res.json()) as ServerEnvelope;
    if (!envelope.ok || !envelope.data) {
      throw new PlantingIdentifyError(
        envelope.error?.message ?? '読み取りに失敗しました。時間をおいてお試しください。',
        envelope.error?.retryable ?? true,
        kindFromCode(envelope.error?.code),
      );
    }
    return envelope.data;
  } catch (err) {
    if (err instanceof PlantingIdentifyError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PlantingIdentifyError(
        '時間内に応答がありませんでした。もう一度お試しください。',
        true,
      );
    }
    throw new PlantingIdentifyError(
      'ネットワークに接続できませんでした。電波の良い場所でお試しください。',
      true,
      'offline',
    );
  } finally {
    clearTimeout(timer);
  }
}

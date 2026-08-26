/**
 * AI 相談（R14/R15・WBS 3.10/3.11）— 栽培写真 → 品種推定・原因候補・一般的な対処。
 *
 * 推論はだいどこの Railway サーバーに相乗りしている（WBS 決定⑨）。
 * プロンプトと §8.4 の農薬ガードは**サーバー側**（garden-vision.ts）に閉じており、
 * 端末からは写真・作物名・相談文を送るだけ。
 *
 * 無料枠は usage.service（1 日 N 回・app_meta カウント）を共有する。
 * このモジュールは枠を消費しない — 呼び出し側が「成功して isPlant だったら
 * recordCloudInference()」を呼ぶ（植物が写っていない判定は枠を消費させない。
 * だいどこの not_a_dish と同じ扱い）。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { API_V1 } from '../config';

/** アップロード前の縮小長辺（px）。保存写真の 1600 より小さくして通信量を抑える */
export const CONSULT_UPLOAD_MAX_DIMENSION = 1024;
const UPLOAD_JPEG_QUALITY = 0.7;
const TIMEOUT_MS = 60_000;

export type ConsultConfidence = 'high' | 'medium' | 'low';
export type ConsultHealthStatus = 'healthy' | 'concern' | 'unknown';

export interface ConsultIssue {
  name: string;
  likelihood?: ConsultConfidence;
  /** 根拠となる見た目の特徴 */
  signs?: string;
}

/** サーバー（garden-vision.ts）の GardenConsultRaw と同じ形 */
export interface GardenConsultResult {
  isPlant: boolean;
  plantGuess?: string;
  plantConfidence?: ConsultConfidence;
  healthStatus?: ConsultHealthStatus;
  issues?: ConsultIssue[];
  advice?: string[];
  checkPoints?: string[];
}

export type ConsultErrorKind = 'offline' | 'transient' | 'rate_limited' | 'unavailable';

export class GardenConsultError extends Error {
  readonly retryable: boolean;
  readonly kind: ConsultErrorKind;
  constructor(message: string, retryable: boolean, kind: ConsultErrorKind = 'transient') {
    super(message);
    this.name = 'GardenConsultError';
    this.retryable = retryable;
    this.kind = kind;
  }
}

interface ServerEnvelope {
  ok: boolean;
  data?: GardenConsultResult;
  error?: { code?: string; message?: string; retryable?: boolean };
}

function kindFromCode(code: string | undefined): ConsultErrorKind {
  if (code === 'RATE_LIMITED') return 'rate_limited';
  if (code === 'AI_API_UNAVAILABLE') return 'unavailable';
  return 'transient';
}

// ─── 画像のアップロード準備 ──────────────────────────────────────────────────

export interface ConsultImageAdapter {
  /** 縮小した JPEG の base64 を返す。失敗時は throw してよい */
  prepare: (uri: string) => Promise<{ base64: string; mimeType: string }>;
}

const expoConsultImageAdapter: ConsultImageAdapter = {
  async prepare(uri) {
    // 原寸のカメラ写真（2〜5MB）をそのまま base64 にするとリクエストが
    // 数 MB に膨らむ。長辺 1024px へ縮小してから送る（診断精度には十分）。
    let sendUri = uri;
    try {
      const context = ImageManipulator.manipulate(uri);
      const original = await context.renderAsync();
      if (Math.max(original.width, original.height) > CONSULT_UPLOAD_MAX_DIMENSION) {
        context.resize(
          original.width >= original.height
            ? { width: CONSULT_UPLOAD_MAX_DIMENSION }
            : { height: CONSULT_UPLOAD_MAX_DIMENSION },
        );
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: UPLOAD_JPEG_QUALITY,
      });
      sendUri = saved.uri;
    } catch {
      // **原本のまま送らない。** 再エンコードを経ないと EXIF の GPS が残り、
      // 縮小に失敗した写真だけ撮影場所つきでサーバーへ出てしまう。
      // 保存側（photo-storage.service）と同じく fail closed にする
      throw new Error('写真を読み込めませんでした');
    }
    const base64 = await FileSystem.readAsStringAsync(sendUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64, mimeType: 'image/jpeg' };
  },
};

// ─── 相談リクエスト ──────────────────────────────────────────────────────────

export interface ConsultArgs {
  /** 端末内の写真パス（一時ファイルでよい — 相談は写真を保存しない） */
  imageUri: string;
  /** 栽培に登録されている作物名（品種推定の手がかり） */
  cropName?: string;
  /** 相談・症状の説明。空なら写真だけの診断 */
  question?: string;
}

/**
 * 写真を縮小して base64 で送り、診断結果を返す。
 * 失敗は必ず GardenConsultError で投げる（画面はメッセージを出すだけでよい）。
 */
export async function consultGarden(
  args: ConsultArgs,
  imageAdapter: ConsultImageAdapter = expoConsultImageAdapter,
  fetchFn: typeof fetch = fetch,
): Promise<GardenConsultResult> {
  let base64: string;
  let mimeType: string;
  try {
    ({ base64, mimeType } = await imageAdapter.prepare(args.imageUri));
  } catch {
    throw new GardenConsultError('写真を読み込めませんでした', false);
  }

  const question = args.question?.trim();
  const cropName = args.cropName?.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${API_V1}/garden/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType,
        ...(cropName ? { cropName: cropName.slice(0, 50) } : {}),
        ...(question ? { question } : {}),
        locale: 'ja',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new GardenConsultError(
        `サーバーエラーが発生しました（${res.status}）`,
        res.status >= 500,
      );
    }

    const envelope = (await res.json()) as ServerEnvelope;
    if (!envelope.ok || !envelope.data) {
      throw new GardenConsultError(
        envelope.error?.message ?? '診断に失敗しました。時間をおいてお試しください。',
        envelope.error?.retryable ?? true,
        kindFromCode(envelope.error?.code),
      );
    }
    return envelope.data;
  } catch (err) {
    if (err instanceof GardenConsultError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GardenConsultError(
        '時間内に応答がありませんでした。もう一度お試しください。',
        true,
      );
    }
    throw new GardenConsultError(
      'サーバーに接続できませんでした。通信環境をご確認ください。',
      true,
      'offline',
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── 表示ヘルパ ──────────────────────────────────────────────────────────────

export const CONFIDENCE_LABEL: Record<ConsultConfidence, string> = {
  high: '可能性 高',
  medium: '可能性 中',
  low: '可能性 低',
};

export const HEALTH_STATUS_LABEL: Record<ConsultHealthStatus, string> = {
  healthy: '大きな問題は見当たりません',
  concern: '気になる点があります',
  unknown: '写真からは判断できませんでした',
};

/**
 * 免責（Q5・利用規約 §）。結果画面に必ず出す。
 * 農薬まわりの文言はサーバーのガードと対（§8.4）— 消さないこと。
 */
export const CONSULT_DISCLAIMER =
  'AI の回答は写真からの推定で、誤りを含むことがあります。' +
  '農薬・肥料の使用、収穫物の可食判断など、栽培に関する最終的な判断は' +
  'ご自身の責任で行ってください。農薬は必ず製品ラベルの記載と関係法令に従ってご使用ください。';

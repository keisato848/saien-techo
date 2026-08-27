/**
 * App Store Connect API の共通ヘルパー。
 * submit-asc-version.mjs / store-status.mjs で共有する。
 *
 * 認証: `apps/mobile/eas.json` の `submit.production.ios`（ascApiKeyPath / ascApiKeyId /
 * ascApiKeyIssuerId / ascAppId）が単一ソース。環境変数 ASC_API_KEY_PATH / ASC_API_KEY_ID /
 * ASC_API_ISSUER_ID / ASC_APP_ID で上書きできる（別アプリを見るとき用 — 値をスクリプトに
 * ベタ書きしない。app-identity.mjs と同じ理由）。
 *
 * **秘密鍵（.p8）は読むが、いかなる経路でも出力しない。**
 *
 * JWT は ES256。Node の crypto で `dsaEncoding: 'ieee-p1363'` を指定すると JWT 互換の
 * 署名になる（既定の DER だと Apple に拒否される）。依存パッケージは不要。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EAS_JSON = path.join(ROOT, 'apps/mobile/eas.json');

export const ASC_BASE = 'https://api.appstoreconnect.apple.com/v1';

let cachedConfig = null;

/** eas.json（＋環境変数の上書き）から ASC の接続情報を読む。鍵の中身は含まない */
export function ascConfig() {
  if (cachedConfig) return cachedConfig;
  const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
  const ios = eas.submit?.production?.ios ?? {};
  const cfg = {
    keyPath: process.env.ASC_API_KEY_PATH ?? ios.ascApiKeyPath,
    keyId: process.env.ASC_API_KEY_ID ?? ios.ascApiKeyId,
    issuerId: process.env.ASC_API_ISSUER_ID ?? ios.ascApiKeyIssuerId,
    appId: process.env.ASC_APP_ID ?? ios.ascAppId,
  };
  for (const [k, v] of Object.entries(cfg)) {
    if (!v) throw new Error(`ASC の接続情報が足りません: ${k}（eas.json submit.production.ios）`);
  }
  cachedConfig = cfg;
  return cfg;
}

/** ASC の App ID（例: 6801141151） */
export function ascAppId() {
  return ascConfig().appId;
}

let cachedToken = null;

/** ES256 の JWT を作る（20 分有効・Apple の上限）。鍵は毎回読み、メモリ外に出さない */
export function ascToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 60) return cachedToken.jwt;
  const { keyPath, keyId, issuerId } = ascConfig();
  const key = fs.readFileSync(keyPath, 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = now + 1200;
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({
    iss: issuerId,
    iat: now,
    exp,
    aud: 'appstoreconnect-v1',
  })}`;
  const sig = crypto
    .sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  cachedToken = { jwt: `${unsigned}.${sig}`, exp };
  return cachedToken.jwt;
}

/**
 * ASC API を叩く。失敗は `METHOD path -> status {errors[0]}` で投げる。
 * 204 No Content（relationship の PATCH など）は `{}` を返す。
 */
export async function ascRequest(method, apiPath, body) {
  const res = await fetch(`${ASC_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${ascToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(
      `${method} ${apiPath} -> ${res.status} ${JSON.stringify(json.errors?.[0] ?? json).slice(0, 400)}`,
    );
  }
  return json;
}

export const ascGet = (p) => ascRequest('GET', p);
export const ascPost = (p, body) => ascRequest('POST', p, body);
export const ascPatch = (p, body) => ascRequest('PATCH', p, body);
export const ascDelete = (p) => ascRequest('DELETE', p);

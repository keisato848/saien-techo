import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

/**
 * The four environment variables required for Play Store upload signing.
 * Shared across preflight, pretool-guard, and check-play-signing.
 */
export const SIGNING_ENV_KEYS = [
  'SAIEN_UPLOAD_STORE_FILE',
  'SAIEN_UPLOAD_STORE_PASSWORD',
  'SAIEN_UPLOAD_KEY_ALIAS',
  'SAIEN_UPLOAD_KEY_PASSWORD',
];

/**
 * Classify the current signing environment.
 *
 * @returns {{ status: 'none' | 'partial' | 'complete', present: string[], missing: string[] }}
 */
export function classifySigningEnv() {
  const present = SIGNING_ENV_KEYS.filter((key) => Boolean(process.env[key]));
  const missing = SIGNING_ENV_KEYS.filter((key) => !process.env[key]);

  if (present.length === 0) return { status: 'none', present, missing };
  if (missing.length > 0) return { status: 'partial', present, missing };
  return { status: 'complete', present, missing };
}

/**
 * Verify that the keystore file referenced by SAIEN_UPLOAD_STORE_FILE exists.
 * Throws if the file is not readable.
 *
 * @returns {Promise<string>} The resolved keystore path.
 */
export async function verifyKeystoreFile() {
  const storePath = process.env.SAIEN_UPLOAD_STORE_FILE;
  if (!storePath) {
    throw new Error('SAIEN_UPLOAD_STORE_FILE is not set');
  }
  await access(storePath, fsConstants.R_OK);
  return storePath;
}

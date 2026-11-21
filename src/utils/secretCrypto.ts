import * as crypto from 'node:crypto';
import { config } from '../utils';

const ALGO = 'aes-256-gcm';

function resolveKey(): Buffer | null {
  const raw = String(
    process.env.META_TOKEN_ENCRYPTION_KEY ||
      config.SECRET_KEY ||
      '',
  ).trim();
  if (!raw) return null;
  // Derive 32-byte key from provided secret
  return crypto.createHash('sha256').update(raw).digest();
}

/** Encrypt secret for DB storage. Returns `enc:v1:<iv>:<tag>:<cipher>` or plaintext fallback. */
export function encryptSecret(plain: string): string {
  const key = resolveKey();
  if (!key || !plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(stored: string): string {
  const raw = String(stored || '');
  if (!raw.startsWith('enc:v1:')) return raw;
  const key = resolveKey();
  if (!key) throw new Error('Cannot decrypt secret: encryption key missing');
  const parts = raw.split(':');
  if (parts.length !== 5) throw new Error('Invalid encrypted secret format');
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const data = Buffer.from(parts[4], 'base64url');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

import * as crypto from 'crypto';

function getDerivedKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function getPrimaryEncryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'facturacion-dev-key-change-me';
  return getDerivedKey(raw);
}

function getFallbackEncryptionKey(): Buffer | null {
  if (
    process.env.APP_ENCRYPTION_KEY &&
    process.env.JWT_SECRET &&
    process.env.APP_ENCRYPTION_KEY !== process.env.JWT_SECRET
  ) {
    return getDerivedKey(process.env.JWT_SECRET);
  }
  return null;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored || !plain) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function encryptSecret(plain?: string | null): string {
  const text = plain === null || plain === undefined ? '' : String(plain);
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getPrimaryEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `encv1$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

function decryptWithKey(ivHex: string, tagHex: string, encHex: string, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final()
  ]);
}

export function decryptSecret(payload?: string | null): string {
  if (!payload) return '';
  if (!payload.startsWith('encv1$')) return payload;
  const parts = payload.split('$');
  if (parts.length !== 4) return '';
  const [, ivHex, tagHex, encHex] = parts;

  try {
    const decrypted = decryptWithKey(ivHex, tagHex, encHex, getPrimaryEncryptionKey());
    return decrypted.toString('utf8');
  } catch (errPrimary) {
    const fallbackKey = getFallbackEncryptionKey();
    if (fallbackKey) {
      try {
        const decryptedFallback = decryptWithKey(ivHex, tagHex, encHex, fallbackKey);
        return decryptedFallback.toString('utf8');
      } catch {
        // Fallback también falló
      }
    }
    return '';
  }
}

export function encryptBuffer(buf: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getPrimaryEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `bufv1$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

export function decryptBuffer(payload?: string | null): Buffer | null {
  if (!payload || !payload.startsWith('bufv1$')) return null;
  const parts = payload.split('$');
  if (parts.length !== 4) return null;
  const [, ivHex, tagHex, encHex] = parts;

  try {
    return decryptWithKey(ivHex, tagHex, encHex, getPrimaryEncryptionKey());
  } catch (errPrimary) {
    const fallbackKey = getFallbackEncryptionKey();
    if (fallbackKey) {
      try {
        return decryptWithKey(ivHex, tagHex, encHex, fallbackKey);
      } catch {
        // Fallback también falló
      }
    }
    return null;
  }
}

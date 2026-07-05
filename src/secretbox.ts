import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Encrypts integration secrets before they touch disk so a leaked SQLite volume
 * is not a leaked set of credentials. The key is derived from ADMIN_PASSWORD +
 * a per-install random salt, so the password alone (without the volume) or the
 * volume alone (without the password) is useless.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(password: string, salt: Buffer) {
    this.key = scryptSync(password, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  /** Returns null when the ciphertext cannot be decrypted (e.g. password changed). */
  decrypt(encoded: string): string | null {
    try {
      const buf = Buffer.from(encoded, 'base64');
      if (buf.length < IV_LEN + TAG_LEN) return null;
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(buf.length - TAG_LEN);
      const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Still compare against a fixed buffer to avoid leaking length via timing.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

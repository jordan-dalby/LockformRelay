import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { constantTimeEquals } from './secretbox.js';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Issues and verifies short-lived admin session tokens signed with a random key
 * generated at boot. A restart invalidates all sessions (the user re-enters the
 * relay password) - acceptable, and it means no long-lived credential is stored.
 */
export class AdminAuth {
  private readonly password: string;
  private readonly sessionKey: Buffer;
  private readonly attempts = new Map<string, { fails: number; lockedUntil: number }>();

  constructor(password: string) {
    this.password = password;
    this.sessionKey = randomBytes(32);
  }

  private sign(payloadB64: string): string {
    return b64url(createHmac('sha256', this.sessionKey).update(payloadB64).digest());
  }

  issueToken(): string {
    const payload = b64url(Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })));
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string | undefined): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sig] = parts as [string, string];

    const expected = this.sign(payloadB64);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
        exp?: number;
      };
      return typeof payload.exp === 'number' && payload.exp > Date.now();
    } catch {
      return false;
    }
  }

  // ── Password check with per-IP rate limiting ──────────────────────────────

  isLockedOut(ip: string): number {
    const entry = this.attempts.get(ip);
    if (entry && entry.lockedUntil > Date.now()) {
      return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    }
    return 0;
  }

  /** Returns true and clears the fail counter on success; records a fail otherwise. */
  checkPassword(ip: string, candidate: string): boolean {
    const ok = constantTimeEquals(candidate, this.password);
    const entry = this.attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
    if (ok) {
      this.attempts.delete(ip);
      return true;
    }
    entry.fails += 1;
    if (entry.fails >= MAX_FAILS) {
      entry.lockedUntil = Date.now() + LOCKOUT_MS;
      entry.fails = 0;
    }
    this.attempts.set(ip, entry);
    return false;
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

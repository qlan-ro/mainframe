import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TokenPayload {
  deviceId: string;
  iat: number;
}

export function generateToken(secret: string, deviceId: string): string {
  const payload: TokenPayload = { deviceId, iat: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function validateToken(secret: string, token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = createHmac('sha256', secret).update(payloadB64!).digest('base64url');

  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(sig ?? '');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

  try {
    return JSON.parse(Buffer.from(payloadB64!, 'base64url').toString()) as TokenPayload;
  } catch {
    return null;
  }
}

export function generatePairingCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

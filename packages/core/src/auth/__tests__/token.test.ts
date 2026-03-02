import { describe, it, expect } from 'vitest';
import { generateToken, validateToken, generatePairingCode } from '../token.js';

describe('token', () => {
  const secret = 'test-secret-key-at-least-32-chars-long!!';

  it('generates a valid JWT that can be validated', () => {
    const token = generateToken(secret, 'mobile-device-1');
    expect(typeof token).toBe('string');

    const payload = validateToken(secret, token);
    expect(payload).not.toBeNull();
    expect(payload!.deviceId).toBe('mobile-device-1');
  });

  it('rejects an invalid token', () => {
    const result = validateToken(secret, 'garbage-token');
    expect(result).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = generateToken('other-secret-that-is-also-32-chars!!', 'device');
    const result = validateToken(secret, token);
    expect(result).toBeNull();
  });

  it('generates a 6-character alphanumeric pairing code', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });
});

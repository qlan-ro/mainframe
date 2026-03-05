import { describe, it, expect } from 'vitest';
import { isWsAuthRequired } from '../websocket.js';

describe('WebSocket auth', () => {
  it('requires auth for non-localhost when secret is set', () => {
    expect(isWsAuthRequired('192.168.1.100', 'test-secret')).toBe(true);
  });

  it('does not require auth for localhost', () => {
    expect(isWsAuthRequired('127.0.0.1', 'test-secret')).toBe(false);
    expect(isWsAuthRequired('::1', 'test-secret')).toBe(false);
    expect(isWsAuthRequired('::ffff:127.0.0.1', 'test-secret')).toBe(false);
  });

  it('does not require auth when no secret is configured', () => {
    expect(isWsAuthRequired('192.168.1.100', null)).toBe(false);
  });
});

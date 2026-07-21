import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../cors-origin.js';

describe('isAllowedOrigin', () => {
  it.each([
    ['http localhost with a dev vite port', 'http://localhost:5174'],
    ['http localhost with the daemon port', 'http://localhost:31500'],
    ['http 127.0.0.1 with a port', 'http://127.0.0.1:31500'],
    ['https localhost with a port', 'https://localhost:5174'],
    ['http localhost with no port', 'http://localhost'],
    ['the packaged Tauri macOS/Linux custom scheme origin', 'tauri://localhost'],
    ['the packaged Tauri Windows http origin', 'http://tauri.localhost'],
    ['the packaged Tauri Windows https origin', 'https://tauri.localhost'],
  ])('allows %s', (_label, origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each([
    ['an undefined origin', undefined],
    ['an empty string origin', ''],
    ['an unrelated external origin', 'http://evil.com'],
    ['an https external origin', 'https://example.com'],
    ['a domain that merely starts with localhost', 'http://localhost.evil.com'],
    ['a domain that merely starts with 127.0.0.1', 'http://127.0.0.1.evil.com'],
    ['a tauri scheme with a non-localhost host', 'tauri://evil'],
    ['the literal "null" origin sent by file:// contexts', 'null'],
  ])('rejects %s', (_label, origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

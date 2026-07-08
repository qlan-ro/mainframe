import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../cors-origin.js';

describe('isAllowedOrigin', () => {
  it('allows http localhost with a dev vite port', () => {
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true);
  });

  it('allows http localhost with the daemon port', () => {
    expect(isAllowedOrigin('http://localhost:31500')).toBe(true);
  });

  it('allows http 127.0.0.1 with a port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:31500')).toBe(true);
  });

  it('allows https localhost with a port', () => {
    expect(isAllowedOrigin('https://localhost:5174')).toBe(true);
  });

  it('allows http localhost with no port', () => {
    expect(isAllowedOrigin('http://localhost')).toBe(true);
  });

  it('allows the packaged Tauri macOS/Linux custom scheme origin', () => {
    expect(isAllowedOrigin('tauri://localhost')).toBe(true);
  });

  it('allows the packaged Tauri Windows http origin', () => {
    expect(isAllowedOrigin('http://tauri.localhost')).toBe(true);
  });

  it('allows the packaged Tauri Windows https origin', () => {
    expect(isAllowedOrigin('https://tauri.localhost')).toBe(true);
  });

  it('rejects an undefined origin', () => {
    expect(isAllowedOrigin(undefined)).toBe(false);
  });

  it('rejects an empty string origin', () => {
    expect(isAllowedOrigin('')).toBe(false);
  });

  it('rejects an unrelated external origin', () => {
    expect(isAllowedOrigin('http://evil.com')).toBe(false);
  });

  it('rejects an https external origin', () => {
    expect(isAllowedOrigin('https://example.com')).toBe(false);
  });

  it('rejects a domain that merely starts with localhost', () => {
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
  });

  it('rejects a domain that merely starts with 127.0.0.1', () => {
    expect(isAllowedOrigin('http://127.0.0.1.evil.com')).toBe(false);
  });

  it('rejects a tauri scheme with a non-localhost host', () => {
    expect(isAllowedOrigin('tauri://evil')).toBe(false);
  });

  it('rejects the literal "null" origin sent by file:// contexts', () => {
    expect(isAllowedOrigin('null')).toBe(false);
  });
});

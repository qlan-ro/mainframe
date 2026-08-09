/**
 * endpoint-policy — TDD test.
 *
 * Behaviors covered:
 *  1. checkEndpointPolicy allows http only for loopback hosts (127.0.0.1, localhost),
 *     case-insensitively, and refuses it everywhere else — including the ::1 literal,
 *     which the CSP grammar cannot express reliably (see plan decision 1).
 *  2. https is always allowed, with or without an explicit scheme in the input.
 *  3. An unparseable input refuses with 'invalid-url'.
 *  4. Allowed results carry the parsed RemoteUrlParts.
 *  5. INSECURE_ENDPOINT_MESSAGE names both loopback forms.
 */
import { describe, it, expect } from 'vitest';
import { checkEndpointPolicy, INSECURE_ENDPOINT_MESSAGE } from '../endpoint-policy';

describe('checkEndpointPolicy', () => {
  it.each([
    ['http://127.0.0.1:31500', true],
    ['http://localhost:31500', true],
    ['HTTP://LocalHost:31500', true],
    ['http://192.168.1.10:31415', false],
    ['http://box.example.com', false],
    ['http://[::1]:31500', false],
    ['https://tunnel.example.com', true],
    ['tunnel.example.com', true],
  ] as const)('%s → allowed:%s', (url, allowed) => {
    const result = checkEndpointPolicy(url);
    expect(result.allowed).toBe(allowed);
  });

  it('refuses a non-loopback http host with reason insecure-host', () => {
    const result = checkEndpointPolicy('http://192.168.1.10:31415');
    expect(result).toMatchObject({ allowed: false, reason: 'insecure-host' });
  });

  it('refuses the ::1 IPv6 loopback literal like any other non-loopback host', () => {
    const result = checkEndpointPolicy('http://[::1]:31500');
    expect(result).toMatchObject({ allowed: false, reason: 'insecure-host' });
  });

  it('refuses an unparseable input with reason invalid-url', () => {
    const result = checkEndpointPolicy('not a url ##');
    expect(result).toMatchObject({ allowed: false, reason: 'invalid-url' });
  });

  it('carries the parsed RemoteUrlParts on an allowed result', () => {
    const result = checkEndpointPolicy('http://127.0.0.1:31500');
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.parts).toEqual({ host: '127.0.0.1:31500', baseUrl: 'http://127.0.0.1:31500', scheme: 'http' });
    }
  });

  it('parses a no-scheme input as https when allowed', () => {
    const result = checkEndpointPolicy('tunnel.example.com');
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.parts.scheme).toBe('https');
    }
  });

  it('exposes a non-empty refusal message naming both loopback forms', () => {
    expect(INSECURE_ENDPOINT_MESSAGE.length).toBeGreaterThan(0);
    expect(INSECURE_ENDPOINT_MESSAGE).toContain('127.0.0.1');
    expect(INSECURE_ENDPOINT_MESSAGE).toContain('localhost');
  });
});

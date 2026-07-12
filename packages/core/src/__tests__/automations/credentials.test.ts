// packages/core/src/__tests__/automations/credentials.test.ts
//
// Task 14: FileCredentialStore ported verbatim from workflows/credentials.ts
// onto the v2 Credentials type, at <dataDir>/automation-credentials.json.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { FileCredentialStore } from '../../automations/credentials.js';

const silentLogger = pino({ level: 'silent' });

describe('FileCredentialStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automation-credentials-'));
    filePath = join(dir, 'automation-credentials.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for an unknown label before any file exists', () => {
    const store = new FileCredentialStore(filePath, silentLogger);
    expect(store.get('missing')).toBeNull();
    expect(store.labels()).toEqual([]);
  });

  it('set/get round-trips a credential and persists it to disk with 0600 perms', async () => {
    const store = new FileCredentialStore(filePath, silentLogger);
    await store.set('gh-pat', { kind: 'token', token: 'secret123' });
    expect(store.get('gh-pat')).toEqual({ kind: 'token', token: 'secret123' });
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('set() resolves the in-memory cache synchronously, before the write settles', () => {
    const store = new FileCredentialStore(filePath, silentLogger);
    const pending = store.set('gh-pat', { kind: 'token', token: 'secret123' });
    expect(store.get('gh-pat')).toEqual({ kind: 'token', token: 'secret123' });
    return pending;
  });

  it('delete removes a label', async () => {
    const store = new FileCredentialStore(filePath, silentLogger);
    await store.set('gh-pat', { kind: 'token', token: 'secret123' });
    await store.delete('gh-pat');
    expect(store.get('gh-pat')).toBeNull();
    expect(store.labels()).toEqual([]);
  });

  it('labels() lists labels without ever exposing token values', async () => {
    const store = new FileCredentialStore(filePath, silentLogger);
    await store.set('gh-pat', { kind: 'token', token: 'secret123' });
    await store.set('notion', { kind: 'token', token: 'other-secret' });
    expect(store.labels().sort()).toEqual(['gh-pat', 'notion']);
    expect(JSON.stringify(store.labels())).not.toContain('secret123');
    expect(JSON.stringify(store.labels())).not.toContain('other-secret');
  });

  it('an unreadable/corrupt file is treated as empty rather than throwing', () => {
    writeFileSync(filePath, '{not valid json', { mode: 0o600 });
    const store = new FileCredentialStore(filePath, silentLogger);
    expect(store.get('anything')).toBeNull();
    expect(store.labels()).toEqual([]);
  });

  it('a fresh store instance reads back a previously persisted credential', async () => {
    const store1 = new FileCredentialStore(filePath, silentLogger);
    await store1.set('gh-pat', { kind: 'token', token: 'secret123' });
    const store2 = new FileCredentialStore(filePath, silentLogger);
    expect(store2.get('gh-pat')).toEqual({ kind: 'token', token: 'secret123' });
  });
});

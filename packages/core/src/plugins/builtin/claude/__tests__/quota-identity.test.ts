import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readClaudeAccountIdentity,
  CLAUDE_IDENTITY_UNKNOWN,
  CLAUDE_IDENTITY_TRANSIENT,
} from '../trust-store.js';

function writeClaudeJson(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-id-'));
  const p = join(dir, '.claude.json');
  writeFileSync(p, contents);
  return p;
}

describe('readClaudeAccountIdentity', () => {
  it('returns the oauthAccount.accountUuid when present', async () => {
    const p = writeClaudeJson(JSON.stringify({ oauthAccount: { accountUuid: 'uuid-123', emailAddress: 'a@b.com' } }));
    await expect(readClaudeAccountIdentity(p)).resolves.toBe('uuid-123');
  });

  it('falls back to emailAddress when accountUuid is absent', async () => {
    const p = writeClaudeJson(JSON.stringify({ oauthAccount: { emailAddress: 'a@b.com' } }));
    await expect(readClaudeAccountIdentity(p)).resolves.toBe('a@b.com');
  });

  it('returns the unknown bucket when there is no oauthAccount', async () => {
    const p = writeClaudeJson(JSON.stringify({ projects: {} }));
    await expect(readClaudeAccountIdentity(p)).resolves.toBe(CLAUDE_IDENTITY_UNKNOWN);
  });

  it('returns the unknown bucket when the file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-id-'));
    await expect(readClaudeAccountIdentity(join(dir, 'absent.json'))).resolves.toBe(CLAUDE_IDENTITY_UNKNOWN);
  });

  it('returns the transient sentinel when the file is malformed JSON', async () => {
    const p = writeClaudeJson('{ not json');
    await expect(readClaudeAccountIdentity(p)).resolves.toBe(CLAUDE_IDENTITY_TRANSIENT);
  });
});

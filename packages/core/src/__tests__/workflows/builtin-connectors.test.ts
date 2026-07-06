import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { filesConnector } from '../../workflows/connectors/files.js';
import { bashConnector } from '../../workflows/connectors/bash.js';
import { FileCredentialStore } from '../../workflows/credentials.js';
import type { ActionCtx } from '../../workflows/connectors/types.js';

function ctx(): ActionCtx {
  return {
    creds: null,
    idempotencyKey: 'r:s:1',
    signal: new AbortController().signal,
    logger: pino({ level: 'silent' }),
    resolvePath: (p) => p,
  };
}

describe('builtin connectors', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfconn-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('files.append creates and appends; files.read reads', async () => {
    const file = join(dir, 'log.md');
    await filesConnector.actions['append']!.run(ctx(), { path: file, content: '# one\n' });
    await filesConnector.actions['append']!.run(ctx(), { path: file, content: '# two\n' });
    expect(readFileSync(file, 'utf8')).toBe('# one\n# two\n');
    const out = (await filesConnector.actions['read']!.run(ctx(), { path: file })) as { content: string };
    expect(out.content).toContain('# two');
  });

  it('bash.run captures stdout/exit code without shell interpolation', async () => {
    const out = (await bashConnector.actions['run']!.run(ctx(), {
      command: 'printf',
      args: ['hello %s', 'world'],
      cwd: dir,
      timeoutMs: 5000,
    })) as { exitCode: number; stdout: string };
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe('hello world');
  });

  it('bash.run reports non-zero exit codes as output, not as a thrown error', async () => {
    const out = (await bashConnector.actions['run']!.run(ctx(), {
      command: 'false',
      args: [],
      cwd: dir,
      timeoutMs: 5000,
    })) as { exitCode: number };
    expect(out.exitCode).toBe(1);
  });

  it('credential store round-trips and lists labels only', () => {
    const store = new FileCredentialStore(join(dir, 'credentials.json'), pino({ level: 'silent' }));
    store.set('gh-pat', { kind: 'token', token: 'secret123' });
    expect(store.get('gh-pat')?.token).toBe('secret123');
    expect(store.labels()).toEqual(['gh-pat']);
    expect(JSON.stringify(store.labels())).not.toContain('secret123');
  });
});

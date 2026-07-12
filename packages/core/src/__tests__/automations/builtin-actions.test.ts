// packages/core/src/__tests__/automations/builtin-actions.test.ts
//
// Task 13: files.* drop `path` from outputs (append/write have none, read is
// `content` only) and http.request drops `headers`, returning raw text
// `body` instead of parsed JSON (contract §5).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { filesAppendAction, filesReadAction, filesWriteAction } from '../../automations/actions/files.js';
import { httpRequestAction } from '../../automations/actions/http.js';
import type { ActionCtx } from '../../automations/actions/types.js';

const silentLogger = pino({ level: 'silent' });

function ctxFor(projectRoot: string, overrides: Partial<ActionCtx> = {}): ActionCtx {
  return {
    creds: null,
    idempotencyKey: 'run-1:step-1:0',
    signal: new AbortController().signal,
    logger: silentLogger,
    resolvePath: (p) => join(projectRoot, p),
    projectRoot,
    ...overrides,
  };
}

describe('files actions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'files-action-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('files.write creates the file and returns no outputs', async () => {
    const outcome = await filesWriteAction.run(ctxFor(dir), { path: 'note.txt', content: 'hello' });
    expect(outcome).toEqual({});
    expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toBe('hello');
  });

  it('files.append creates parent directories and appends, with no outputs', async () => {
    await filesAppendAction.run(ctxFor(dir), { path: 'nested/note.txt', content: 'a' });
    const outcome = await filesAppendAction.run(ctxFor(dir), { path: 'nested/note.txt', content: 'b' });
    expect(outcome).toEqual({});
    expect(readFileSync(join(dir, 'nested/note.txt'), 'utf8')).toBe('ab');
  });

  it('files.read returns content and NO path key', async () => {
    writeFileSync(join(dir, 'note.txt'), 'line1\nline2\n');
    const outcome = await filesReadAction.run(ctxFor(dir), { path: 'note.txt' });
    expect(outcome).toEqual({ content: 'line1\nline2\n' });
    expect(outcome).not.toHaveProperty('path');
  });

  it('files.read with outputAs "lines" splits trimmed non-empty lines', async () => {
    writeFileSync(join(dir, 'note.txt'), 'line1\n\n  line2  \nline3\n');
    const outcome = await filesReadAction.run(ctxFor(dir), { path: 'note.txt', outputAs: 'lines' });
    expect(outcome.content).toEqual(['line1', 'line2', 'line3']);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(filesAppendAction.id).toBe('files.append');
    expect(filesWriteAction.id).toBe('files.write');
    expect(filesReadAction.id).toBe('files.read');
    expect(filesAppendAction.outputs).toEqual([]);
    expect(filesWriteAction.outputs).toEqual([]);
    expect(filesReadAction.outputs).toEqual([{ name: 'content', type: 'text' }]);
    expect(filesAppendAction.idempotent).toBe(false);
    expect(filesWriteAction.idempotent).toBe(true);
    expect(filesReadAction.idempotent).toBe(true);
  });
});

describe('http.request action', () => {
  const originalFetch = global.fetch;

  function ctx(overrides: Partial<ActionCtx> = {}): ActionCtx {
    return {
      creds: null,
      idempotencyKey: 'run-1:step-1:0',
      signal: new AbortController().signal,
      logger: silentLogger,
      resolvePath: (p) => p,
      projectRoot: '/tmp',
      ...overrides,
    };
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns status and raw body text, with no headers key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('{"ok":true}'),
    });
    const outcome = await httpRequestAction.run(ctx(), { url: 'https://example.com/api', method: 'GET' });
    expect(outcome).toEqual({ status: 200, body: '{"ok":true}' });
    expect(outcome).not.toHaveProperty('headers');
  });

  it('adds a bearer token from credentials when no authorization header is set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: new Headers(), text: () => Promise.resolve('') });
    global.fetch = fetchMock;
    await httpRequestAction.run(ctx({ creds: { kind: 'token', token: 'sekret' } }), {
      url: 'https://example.com/api',
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get('authorization')).toBe('Bearer sekret');
  });

  it('JSON-encodes a record body and sets content-type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: new Headers(), text: () => Promise.resolve('') });
    global.fetch = fetchMock;
    await httpRequestAction.run(ctx(), { url: 'https://example.com/api', method: 'POST', body: { a: 1 } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('throws on a non-2xx response with the status in the message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers(),
      text: () => Promise.resolve('not found'),
    });
    await expect(httpRequestAction.run(ctx(), { url: 'https://example.com/missing' })).rejects.toThrow(/404/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(httpRequestAction.id).toBe('http.request');
    expect(httpRequestAction.outputs).toEqual([
      { name: 'status', type: 'number' },
      { name: 'body', type: 'text' },
    ]);
    expect(httpRequestAction.idempotent).toBe(false);
  });
});

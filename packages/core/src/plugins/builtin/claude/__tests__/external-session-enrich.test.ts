import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  open: vi.fn(),
  stat: vi.fn(),
}));

import { open, stat } from 'node:fs/promises';
import { enrichSession, SYNTHETIC_TITLE, type Candidate } from '../external-session-enrich.js';

const mockOpen = vi.mocked(open);
const mockStat = vi.mocked(stat);

/** Make `open()` return a fake handle whose read() fills the buffer with `content`. */
function mockFileContent(content: string): void {
  const bytes = Buffer.from(content, 'utf-8');
  mockStat.mockResolvedValue({ size: bytes.length, mtimeMs: 1_000 } as never);
  const handle = {
    read: vi.fn(async (buf: Buffer, off: number, len: number, pos: number) => {
      const slice = bytes.subarray(pos, pos + len);
      slice.copy(buf, off);
      return { bytesRead: slice.length, buffer: buf };
    }),
    close: vi.fn(async () => undefined),
  };
  mockOpen.mockResolvedValue(handle as never);
}

const cand: Candidate = { sessionId: 'abc', filePath: '/x/abc.jsonl', mtimeMs: 1000, size: 0 };

describe('enrichSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses customTitle over aiTitle over firstPrompt', async () => {
    mockFileContent(
      [
        JSON.stringify({
          type: 'user',
          cwd: '/p',
          timestamp: '2026-01-01T00:00:00Z',
          customTitle: 'My Title',
          aiTitle: 'AI Title',
          message: { content: 'Fix login' },
        }),
      ].join('\n'),
    );
    const s = await enrichSession(cand, '/p');
    expect(s?.title).toBe('My Title');
  });

  it('falls back to aiTitle then firstPrompt', async () => {
    mockFileContent(
      JSON.stringify({
        type: 'user',
        cwd: '/p',
        timestamp: '2026-01-01T00:00:00Z',
        aiTitle: 'AI Title',
        message: { content: 'Fix login' },
      }),
    );
    expect((await enrichSession(cand, '/p'))?.title).toBe('AI Title');

    mockFileContent(
      JSON.stringify({ type: 'user', cwd: '/p', timestamp: '2026-01-01T00:00:00Z', message: { content: 'Fix login' } }),
    );
    const s = await enrichSession(cand, '/p');
    expect(s?.title).toBe('Fix login');
    expect(s?.firstPrompt).toBe('Fix login');
  });

  it('drops sidechain sessions', async () => {
    mockFileContent(JSON.stringify({ type: 'user', isSidechain: true, cwd: '/p', message: { content: 'x' } }));
    expect(await enrichSession(cand, '/p')).toBeNull();
  });

  it('drops team sessions', async () => {
    mockFileContent(JSON.stringify({ type: 'user', teamName: 'acme', cwd: '/p', message: { content: 'x' } }));
    expect(await enrichSession(cand, '/p')).toBeNull();
  });

  it('drops wrong-cwd sessions (sibling project)', async () => {
    mockFileContent(
      JSON.stringify({ type: 'user', cwd: '/p-web', timestamp: '2026-01-01T00:00:00Z', message: { content: 'x' } }),
    );
    expect(await enrichSession(cand, '/p')).toBeNull();
  });

  it('keeps empty session with synthetic title', async () => {
    mockFileContent(JSON.stringify({ type: 'system', cwd: '/p', timestamp: '2026-01-01T00:00:00Z' }));
    const s = await enrichSession(cand, '/p');
    expect(s?.title).toBe(SYNTHETIC_TITLE);
  });
});

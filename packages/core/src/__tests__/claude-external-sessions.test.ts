import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn(async (p: string) => p),
  open: vi.fn(),
}));

import { readdir, stat, open } from 'node:fs/promises';
import { listExternalSessions } from '../plugins/builtin/claude/external-sessions.js';
import { clearExternalSessionCache } from '../plugins/builtin/claude/external-session-cache.js';

const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockOpen = vi.mocked(open);

const PROJECT = '/test/project';
const ENC = '-test-project';

/** Per-file content keyed by absolute path; open() serves the right bytes. */
let fileContent: Record<string, string> = {};

function setFiles(filesByDir: Record<string, string[]>, content: Record<string, string>): void {
  fileContent = content;
  mockReaddir.mockImplementation(async (p: unknown) => {
    const s = String(p);
    if (s.endsWith(path.join('.claude', 'projects'))) return Object.keys(filesByDir) as never;
    const dirName = path.basename(s);
    return (filesByDir[dirName] ?? []) as never;
  });
  mockStat.mockImplementation(async (p: unknown) => {
    const body = fileContent[String(p)] ?? '';
    return { size: Buffer.byteLength(body), mtime: new Date('2026-01-01T00:00:00Z'), mtimeMs: 1000 } as never;
  });
  mockOpen.mockImplementation(async (p: unknown) => {
    const bytes = Buffer.from(fileContent[String(p)] ?? '', 'utf-8');
    return {
      stat: async () => ({ size: bytes.length, mtimeMs: 1000 }),
      read: async (buf: Buffer, off: number, len: number, pos: number) => {
        const slice = bytes.subarray(pos, pos + len);
        slice.copy(buf, off);
        return { bytesRead: slice.length, buffer: buf };
      },
      close: async () => undefined,
    } as never;
  });
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userLine = (extra: Record<string, unknown>) =>
  JSON.stringify({ type: 'user', cwd: PROJECT, timestamp: '2026-01-01T00:00:00Z', ...extra });

describe('listExternalSessions (paged)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearExternalSessionCache();
  });

  it('returns enriched sessions for a project, newest first', async () => {
    const a = uuid(1);
    const b = uuid(2);
    setFiles(
      { [ENC]: [`${a}.jsonl`, `${b}.jsonl`] },
      {
        [path.join('/', ENC.replace(/-/g, '-'))]: '', // placeholder, see absolute paths below
      },
    );
    // Provide content by absolute path the scanner will build.
    const root = path.join(homedir(), '.claude', 'projects', ENC);
    fileContent = {
      [path.join(root, `${a}.jsonl`)]: userLine({ message: { content: 'Older' } }),
      [path.join(root, `${b}.jsonl`)]: userLine({ message: { content: 'Newer' } }),
    };
    mockStat.mockImplementation(async (p: unknown) => {
      const isB = String(p).includes(b);
      return {
        size: Buffer.byteLength(fileContent[String(p)] ?? ''),
        mtime: new Date(isB ? '2026-02-01T00:00:00Z' : '2026-01-01T00:00:00Z'),
        mtimeMs: isB ? 2000 : 1000,
      } as never;
    });

    const page = await listExternalSessions(PROJECT, []);
    expect(page.total).toBe(2);
    expect(page.sessions.map((s) => s.sessionId)).toEqual([b, a]);
    expect(page.nextOffset).toBeNull();
  });

  it('skips non-UUID jsonl (progress.jsonl)', async () => {
    const a = uuid(1);
    const root = path.join(homedir(), '.claude', 'projects', ENC);
    setFiles(
      { [ENC]: [`${a}.jsonl`, 'progress.jsonl'] },
      {
        [path.join(root, `${a}.jsonl`)]: userLine({ message: { content: 'Real' } }),
        [path.join(root, 'progress.jsonl')]: userLine({ message: { content: 'Noise' } }),
      },
    );
    const page = await listExternalSessions(PROJECT, []);
    expect(page.total).toBe(1);
    expect(page.sessions[0]!.sessionId).toBe(a);
  });

  it('excludes already-imported session ids', async () => {
    const a = uuid(1);
    const b = uuid(2);
    const root = path.join(homedir(), '.claude', 'projects', ENC);
    setFiles(
      { [ENC]: [`${a}.jsonl`, `${b}.jsonl`] },
      {
        [path.join(root, `${a}.jsonl`)]: userLine({ message: { content: 'Keep' } }),
        [path.join(root, `${b}.jsonl`)]: userLine({ message: { content: 'Excluded' } }),
      },
    );
    const page = await listExternalSessions(PROJECT, [b]);
    expect(page.total).toBe(1);
    expect(page.sessions.map((s) => s.sessionId)).toEqual([a]);
  });

  it('paginates: offset/limit window + nextOffset', async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const root = path.join(homedir(), '.claude', 'projects', ENC);
    setFiles(
      { [ENC]: ids.map((i) => `${i}.jsonl`) },
      Object.fromEntries(
        ids.map((i, n) => [path.join(root, `${i}.jsonl`), userLine({ message: { content: `m${n}` } })]),
      ),
    );
    // all same mtime → tie-break by sessionId desc keeps order deterministic
    const page = await listExternalSessions(PROJECT, [], { offset: 0, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.sessions).toHaveLength(2);
    expect(page.nextOffset).toBe(2);

    const page2 = await listExternalSessions(PROJECT, [], { offset: 2, limit: 2 });
    expect(page2.sessions).toHaveLength(1);
    expect(page2.nextOffset).toBeNull();
  });

  it('limit:0 returns count only (no enrichment)', async () => {
    const a = uuid(1);
    const root = path.join(homedir(), '.claude', 'projects', ENC);
    setFiles({ [ENC]: [`${a}.jsonl`] }, { [path.join(root, `${a}.jsonl`)]: userLine({ message: { content: 'x' } }) });
    const page = await listExternalSessions(PROJECT, [], { limit: 0 });
    expect(page.total).toBe(1);
    expect(page.sessions).toEqual([]);
    expect(page.nextOffset).toBeNull();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('returns empty page when project has no dir', async () => {
    mockReaddir.mockImplementation(async (p: unknown) => {
      if (String(p).endsWith(path.join('.claude', 'projects'))) return [] as never;
      throw new Error('ENOENT');
    });
    const page = await listExternalSessions(PROJECT, []);
    expect(page).toEqual({ sessions: [], total: 0, nextOffset: null });
  });
});

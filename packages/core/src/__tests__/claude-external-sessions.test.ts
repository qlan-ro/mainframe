import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listExternalSessions } from '../plugins/builtin/claude/external-sessions.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: vi.fn(),
  };
});

vi.mock('node:readline', () => ({
  createInterface: vi.fn(),
}));

import { readFile, readdir, stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockAccess = vi.mocked(access);
const mockCreateReadStream = vi.mocked(createReadStream);
const mockCreateInterface = vi.mocked(createInterface);

/** Helper: make createInterface return an async iterable of lines. */
function mockJsonlFile(lines: string[]): void {
  const rl = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) yield line;
    },
    close: vi.fn(),
  };
  mockCreateReadStream.mockReturnValue({ destroy: vi.fn() } as unknown as ReturnType<typeof createReadStream>);
  mockCreateInterface.mockReturnValue(rl as unknown as ReturnType<typeof createInterface>);
}

describe('listExternalSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no index, no JSONL files
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockRejectedValue(new Error('ENOENT'));
    // Default: JSONL files exist on disk (for sessions-index tests)
    mockAccess.mockResolvedValue(undefined);
  });

  describe('from sessions-index.json', () => {
    it('returns sessions from valid index', async () => {
      const index = {
        version: 1,
        entries: [
          {
            sessionId: 'abc-123',
            firstPrompt: 'Hello',
            summary: 'Test session',
            messageCount: 5,
            created: '2026-01-01T00:00:00Z',
            modified: '2026-01-02T00:00:00Z',
            gitBranch: 'main',
            isSidechain: false,
          },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('abc-123');
      expect(result[0]!.adapterId).toBe('claude');
      expect(result[0]!.firstPrompt).toBe('Hello');
      expect(result[0]!.summary).toBe('Test session');
      expect(result[0]!.messageCount).toBe(5);
      expect(result[0]!.gitBranch).toBe('main');
    });

    it('filters out excluded session IDs', async () => {
      const index = {
        version: 1,
        entries: [
          { sessionId: 'keep-me', firstPrompt: 'Keep', created: '2026-01-01T00:00:00Z' },
          { sessionId: 'exclude-me', firstPrompt: 'Exclude', created: '2026-01-01T00:00:00Z' },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

      const result = await listExternalSessions('/test/project', ['exclude-me']);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('keep-me');
    });

    it('filters out sidechain sessions', async () => {
      const index = {
        version: 1,
        entries: [
          { sessionId: 'main-session', firstPrompt: 'Real', created: '2026-01-01T00:00:00Z', isSidechain: false },
          { sessionId: 'sidechain', firstPrompt: 'Side', created: '2026-01-01T00:00:00Z', isSidechain: true },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('main-session');
    });

    it('sorts by modifiedAt descending', async () => {
      const index = {
        version: 1,
        entries: [
          { sessionId: 'older', firstPrompt: 'Old', created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z' },
          { sessionId: 'newer', firstPrompt: 'New', created: '2026-01-02T00:00:00Z', modified: '2026-01-03T00:00:00Z' },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

      const result = await listExternalSessions('/test/project', []);
      expect(result[0]!.sessionId).toBe('newer');
      expect(result[1]!.sessionId).toBe('older');
    });

    it('filters out entries without firstPrompt', async () => {
      const index = {
        version: 1,
        entries: [
          { sessionId: 'with-prompt', firstPrompt: 'Hello', created: '2026-01-01T00:00:00Z' },
          { sessionId: 'no-prompt', created: '2026-01-01T00:00:00Z' },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('with-prompt');
    });
  });

  describe('JSONL fallback (no sessions-index.json)', () => {
    it('returns empty when no index and no directory', async () => {
      const result = await listExternalSessions('/test/project', []);
      expect(result).toEqual([]);
    });

    it('scans JSONL files and extracts first user message', async () => {
      mockReaddir.mockResolvedValue(['abc-123.jsonl'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockStat.mockResolvedValue({ mtime: new Date('2026-01-15T00:00:00Z') } as Awaited<ReturnType<typeof stat>>);

      const lines = [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-01-10T00:00:00Z',
          gitBranch: 'feat/test',
          message: { content: [{ type: 'text', text: 'Fix the login bug' }] },
        }),
      ];
      mockJsonlFile(lines);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('abc-123');
      expect(result[0]!.adapterId).toBe('claude');
      expect(result[0]!.firstPrompt).toBe('Fix the login bug');
      expect(result[0]!.gitBranch).toBe('feat/test');
      expect(result[0]!.createdAt).toBe('2026-01-10T00:00:00Z');
    });

    it('filters out excluded sessions in JSONL scan', async () => {
      mockReaddir.mockResolvedValue(['keep.jsonl', 'skip.jsonl'] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listExternalSessions('/test/project', ['skip']);
      // 'skip' is excluded, only 'keep' should be processed
      expect(mockStat).toHaveBeenCalledTimes(1);
    });

    it('filters out sidechain sessions in JSONL scan', async () => {
      mockReaddir.mockResolvedValue(['side.jsonl'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockStat.mockResolvedValue({ mtime: new Date('2026-01-01T00:00:00Z') } as Awaited<ReturnType<typeof stat>>);

      const lines = [JSON.stringify({ type: 'user', isSidechain: true, timestamp: '2026-01-01T00:00:00Z' })];
      mockJsonlFile(lines);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toEqual([]);
    });

    it('filters out non-session JSONL files (progress, queue-operation)', async () => {
      mockReaddir.mockResolvedValue(['progress.jsonl'] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockStat.mockResolvedValue({ mtime: new Date('2026-01-01T00:00:00Z') } as Awaited<ReturnType<typeof stat>>);

      const lines = [
        JSON.stringify({ type: 'progress', timestamp: '2026-01-01T00:00:00Z' }),
        JSON.stringify({ type: 'progress', timestamp: '2026-01-01T00:01:00Z' }),
      ];
      mockJsonlFile(lines);

      const result = await listExternalSessions('/test/project', []);
      expect(result).toEqual([]);
    });

    it('ignores non-jsonl files', async () => {
      mockReaddir.mockResolvedValue(['readme.md', 'data.json', 'session.jsonl'] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockStat.mockResolvedValue({ mtime: new Date('2026-01-01T00:00:00Z') } as Awaited<ReturnType<typeof stat>>);
      mockJsonlFile([JSON.stringify({ type: 'system', timestamp: '2026-01-01T00:00:00Z' })]);

      const result = await listExternalSessions('/test/project', []);
      // Only session.jsonl should be processed
      expect(mockStat).toHaveBeenCalledTimes(1);
    });
  });
});

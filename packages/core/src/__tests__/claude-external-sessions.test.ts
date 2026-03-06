import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listExternalSessions } from '../plugins/builtin/claude/external-sessions.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

describe('listExternalSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when sessions-index.json does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await listExternalSessions('/test/project', []);
    expect(result).toEqual([]);
  });

  it('returns empty array for malformed JSON', async () => {
    mockReadFile.mockResolvedValue('not json' as unknown as ArrayBuffer);
    const result = await listExternalSessions('/test/project', []);
    expect(result).toEqual([]);
  });

  it('returns empty array when entries is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1 }) as unknown as ArrayBuffer);
    const result = await listExternalSessions('/test/project', []);
    expect(result).toEqual([]);
  });

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
        { sessionId: 'keep-me', created: '2026-01-01T00:00:00Z' },
        { sessionId: 'exclude-me', created: '2026-01-01T00:00:00Z' },
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
        { sessionId: 'main-session', created: '2026-01-01T00:00:00Z', isSidechain: false },
        { sessionId: 'sidechain', created: '2026-01-01T00:00:00Z', isSidechain: true },
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
        { sessionId: 'older', created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z' },
        { sessionId: 'newer', created: '2026-01-02T00:00:00Z', modified: '2026-01-03T00:00:00Z' },
      ],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

    const result = await listExternalSessions('/test/project', []);
    expect(result[0]!.sessionId).toBe('newer');
    expect(result[1]!.sessionId).toBe('older');
  });

  it('filters out entries with no sessionId', async () => {
    const index = {
      version: 1,
      entries: [
        { sessionId: '', created: '2026-01-01T00:00:00Z' },
        { sessionId: 'valid', created: '2026-01-01T00:00:00Z' },
      ],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(index) as unknown as ArrayBuffer);

    const result = await listExternalSessions('/test/project', []);
    expect(result).toHaveLength(1);
    expect(result[0]!.sessionId).toBe('valid');
  });
});

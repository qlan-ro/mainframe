import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConfig } from '@qlan-ro/mainframe-types';
import { getAgents } from '../agents';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_FIXTURE: AgentConfig[] = [
  {
    id: 'claude:project:agent:design-conformance',
    adapterId: 'claude',
    name: 'design-conformance',
    description: 'Reviews components for design conformance',
    scope: 'project',
    filePath: '/home/user/proj/.claude/agents/design-conformance.md',
    content: '# Design Conformance Agent\n',
  },
  {
    id: 'claude:global:agent:code-review',
    adapterId: 'claude',
    name: 'code-review',
    description: 'Reviews code for quality issues',
    scope: 'global',
    filePath: '/home/user/.claude/agents/code-review.md',
    content: '# Code Review Agent\n',
  },
];

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchOk(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchApiError(error: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, error }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

describe('getAgents', () => {
  it('calls GET /api/adapters/<adapterId>/agents with the encoded projectPath query param', async () => {
    mockFetchOk(AGENT_FIXTURE);

    await getAgents(31415, 'claude', '/home/user/proj');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/adapters/claude/agents?projectPath=%2Fhome%2Fuser%2Fproj',
      { method: 'GET' },
    );
  });

  it('URL-encodes the adapterId in the path', async () => {
    mockFetchOk([]);

    await getAgents(31415, 'my:adapter', '/proj');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/adapters/my%3Aadapter/agents');
  });

  it('returns the unwrapped AgentConfig[] from the ApiResponse envelope', async () => {
    mockFetchOk(AGENT_FIXTURE);

    const result = await getAgents(31415, 'claude', '/home/user/proj');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'claude:project:agent:design-conformance',
      adapterId: 'claude',
      name: 'design-conformance',
      description: 'Reviews components for design conformance',
      scope: 'project',
      filePath: '/home/user/proj/.claude/agents/design-conformance.md',
      content: '# Design Conformance Agent\n',
    });
    expect(result[1]).toEqual({
      id: 'claude:global:agent:code-review',
      adapterId: 'claude',
      name: 'code-review',
      description: 'Reviews code for quality issues',
      scope: 'global',
      filePath: '/home/user/.claude/agents/code-review.md',
      content: '# Code Review Agent\n',
    });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('adapter not found');

    await expect(getAgents(31415, 'claude', '/proj')).rejects.toThrow('adapter not found');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not found' }),
      }),
    );

    await expect(getAgents(31415, 'claude', '/proj')).rejects.toThrow('not found');
  });
});

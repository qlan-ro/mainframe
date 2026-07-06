import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Skill } from '@qlan-ro/mainframe-types';
import { getSkills } from '../skills';
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

const SKILL_FIXTURE: Skill[] = [
  {
    id: 'skill-1',
    adapterId: 'claude',
    name: 'my-skill',
    displayName: 'My Skill',
    description: 'Does something useful',
    scope: 'project',
    filePath: '/home/user/alpha/.claude/skills/my-skill.md',
    content: '# My Skill\nDoes something useful.',
    invocationName: 'plugin:my-skill',
  },
  {
    id: 'skill-2',
    adapterId: 'claude',
    name: 'another-skill',
    displayName: 'Another Skill',
    description: 'Does something else',
    scope: 'global',
    filePath: '/home/user/.claude/skills/another-skill.md',
    content: '# Another Skill\nDoes something else.',
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

describe('getSkills', () => {
  it('calls GET /api/adapters/<adapterId>/skills with the encoded projectPath query param', async () => {
    mockFetchOk(SKILL_FIXTURE);

    await getSkills(31415, 'claude', '/home/user/alpha');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/adapters/claude/skills?projectPath=%2Fhome%2Fuser%2Falpha',
      { method: 'GET' },
    );
  });

  it('URL-encodes the adapterId in the path', async () => {
    mockFetchOk([]);

    await getSkills(31415, 'my:adapter', '/proj');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/adapters/my%3Aadapter/skills');
  });

  it('returns the unwrapped Skill[] from the ApiResponse envelope', async () => {
    mockFetchOk(SKILL_FIXTURE);

    const result = await getSkills(31415, 'claude', '/home/user/alpha');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'skill-1',
      adapterId: 'claude',
      name: 'my-skill',
      displayName: 'My Skill',
      description: 'Does something useful',
      scope: 'project',
      filePath: '/home/user/alpha/.claude/skills/my-skill.md',
      content: '# My Skill\nDoes something useful.',
      invocationName: 'plugin:my-skill',
    });
    expect(result[1]).toEqual({
      id: 'skill-2',
      adapterId: 'claude',
      name: 'another-skill',
      displayName: 'Another Skill',
      description: 'Does something else',
      scope: 'global',
      filePath: '/home/user/.claude/skills/another-skill.md',
      content: '# Another Skill\nDoes something else.',
    });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('adapter not found');

    await expect(getSkills(31415, 'claude', '/proj')).rejects.toThrow('adapter not found');
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

    await expect(getSkills(31415, 'claude', '/proj')).rejects.toThrow('not found');
  });
});

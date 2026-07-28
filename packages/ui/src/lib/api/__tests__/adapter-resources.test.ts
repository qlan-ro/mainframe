/**
 * adapter-resources.test.ts — URL contract for the adapter resource listings.
 *
 * `getSkills` and `getAgents` are carbon-copy thin `request` wrappers over
 * GET /api/adapters/:adapterId/{skills|agents}, so they share one
 * parameterized suite (replaces the former skills.test.ts + agents.test.ts).
 * Envelope unwrap/error behavior is pinned once in http-envelope.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSkills, deleteSkill } from '../skills';
import { getAgents } from '../agents';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, data: [] }) }),
  );
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

const RESOURCES = [
  { name: 'getSkills', fn: getSkills, route: 'skills' },
  { name: 'getAgents', fn: getAgents, route: 'agents' },
] as const;

describe('adapter resource listings', () => {
  it.each(RESOURCES)(
    '$name GETs /api/adapters/<adapterId>/$route with the encoded projectPath',
    async ({ fn, route }) => {
      await fn(31415, 'claude', '/home/user/alpha');

      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledWith(
        `http://127.0.0.1:31415/api/adapters/claude/${route}?projectPath=%2Fhome%2Fuser%2Falpha`,
        { method: 'GET' },
      );
    },
  );

  it.each(RESOURCES)('$name URL-encodes the adapterId in the path', async ({ fn, route }) => {
    await fn(31415, 'my:adapter', '/proj');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`/api/adapters/my%3Aadapter/${route}`);
  });
});

describe('deleteSkill', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }));
  });

  it('DELETEs /api/adapters/<adapterId>/skills/<id> with the encoded projectPath', async () => {
    await deleteSkill(31415, 'claude', 'claude:project:review', '/home/user/alpha');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/adapters/claude/skills/claude%3Aproject%3Areview?projectPath=%2Fhome%2Fuser%2Falpha',
      { method: 'DELETE' },
    );
  });

  it('percent-encodes a skill id containing colons in the path', async () => {
    await deleteSkill(31415, 'claude', 'claude:global:tdd', '/proj');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/skills/claude%3Aglobal%3Atdd?');
  });

  it('resolves void on the okEmpty envelope', async () => {
    await expect(deleteSkill(31415, 'claude', 'claude:project:x', '/proj')).resolves.toBeUndefined();
  });

  it('rejects with the envelope error when success is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: false, error: 'Operation failed' }) }),
    );

    await expect(deleteSkill(31415, 'claude', 'claude:project:x', '/proj')).rejects.toThrow('Operation failed');
  });
});

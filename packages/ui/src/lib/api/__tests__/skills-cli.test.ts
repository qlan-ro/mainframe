/**
 * skills-cli.test.ts
 *
 * Red until `../skills-cli` exists (todo #243, plan Group D). Pins the four
 * skills-cli wrapper functions to the wire contract in
 * docs/plans/2026-08-01-todo-243-skills-management-ui-plan.md: URL shape,
 * exact POST bodies, and the raw-fetch error path (`SkillsCliError` carries
 * `tail`/`exitCode` off a 502; a 409 surfaces the daemon's refusal sentence;
 * an "unavailable" manifest resolves rather than throwing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSkillsCliManifest,
  probeSkillsSource,
  installSkills,
  uninstallSkills,
  getSkillsCatalog,
  searchSkills,
  SkillsCliError,
} from '../skills-cli';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

function mockFetchOk(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchOkEmpty(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    }),
  );
}

function mockFetchFail(status: number, body: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

describe('getSkillsCliManifest', () => {
  it('calls GET .../skills-cli/manifest with a URL-encoded project id and adapterId as a query param', async () => {
    mockFetchOk({ status: 'available', entries: [] });

    await getSkillsCliManifest('proj/one two', 'claude');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj%2Fone%20two/skills-cli/manifest?adapterId=claude',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('omits the adapterId query param when none is given', async () => {
    mockFetchOk({ status: 'available', entries: [] });

    await getSkillsCliManifest('proj-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj-1/skills-cli/manifest',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('resolves (does not throw) an "unavailable" manifest, distinguishable by status', async () => {
    mockFetchOk({ status: 'unavailable', executable: 'skills', packageRunner: 'npx skills' });

    const result = await getSkillsCliManifest('proj-1');

    expect(result.status).toBe('unavailable');
  });

  it('resolves (does not throw) a name-only entry the daemon serialized with null source fields', async () => {
    mockFetchOk({
      status: 'available',
      entries: [{ name: 'no-source', scope: 'project', source: null, sourceType: null, skillPath: null }],
    });

    const result = await getSkillsCliManifest('proj-1');

    expect(result).toMatchObject({
      status: 'available',
      entries: [{ name: 'no-source', scope: 'project', source: null }],
    });
  });
});

describe('probeSkillsSource', () => {
  it('POSTs { source, adapterId } to .../skills-cli/probe', async () => {
    mockFetchOk({ status: 'unparseable' });

    await probeSkillsSource('proj-1', 'owner/repo', 'claude');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/projects/proj-1/skills-cli/probe');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ source: 'owner/repo', adapterId: 'claude' });
  });

  it('resolves (does not throw) a bare-name candidate the daemon serialized with a null description', async () => {
    mockFetchOk({ status: 'probed', skills: [{ name: 'bare-name', description: null }] });

    const result = await probeSkillsSource('proj-1', 'owner/repo');

    expect(result).toMatchObject({ status: 'probed', skills: [{ name: 'bare-name', description: null }] });
  });
});

describe('installSkills', () => {
  it('POSTs { source, skills, scope, adapterId } to .../skills-cli/install with skills as an array', async () => {
    mockFetchOkEmpty();

    await installSkills('proj-1', 'owner/repo', ['a', 'b'], 'project', 'claude');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/projects/proj-1/skills-cli/install');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      source: 'owner/repo',
      skills: ['a', 'b'],
      scope: 'project',
      adapterId: 'claude',
    });
  });
});

describe('uninstallSkills', () => {
  it('POSTs { skills, scope, adapterId } to .../skills-cli/uninstall', async () => {
    mockFetchOkEmpty();

    await uninstallSkills('proj-1', ['a'], 'global', 'claude');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/projects/proj-1/skills-cli/uninstall');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ skills: ['a'], scope: 'global', adapterId: 'claude' });
  });
});

describe('skills-cli error propagation', () => {
  it('a 502 failure carries tail and a numeric exitCode onto the thrown SkillsCliError', async () => {
    mockFetchFail(502, { success: false, error: 'exited with status 1', tail: 'error: boom', exitCode: 1 });

    await expect(installSkills('proj-1', 'owner/repo', ['a'], 'project')).rejects.toMatchObject({
      message: 'exited with status 1',
      tail: 'error: boom',
      exitCode: 1,
    });
  });

  it('a 502 failure preserves a null exitCode (spawn failure / timeout)', async () => {
    mockFetchFail(502, { success: false, error: 'timed out', tail: 'installing…', exitCode: null });

    await expect(installSkills('proj-1', 'owner/repo', ['a'], 'project')).rejects.toMatchObject({
      exitCode: null,
    });
  });

  it('a 409 throws an error whose message is the daemon refusal sentence', async () => {
    mockFetchFail(409, { success: false, error: 'A skills operation is already running for this project' });

    await expect(installSkills('proj-1', 'owner/repo', ['a'], 'project')).rejects.toThrow(
      'A skills operation is already running for this project',
    );
  });

  it('thrown errors are instances of SkillsCliError', async () => {
    mockFetchFail(400, { success: false, error: 'Skill name must not start with -' });

    await expect(installSkills('proj-1', 'owner/repo', ['-x'], 'project')).rejects.toBeInstanceOf(SkillsCliError);
  });
});

describe('getSkillsCatalog', () => {
  it('calls GET /api/skills-cli/catalog with no project in the path', async () => {
    mockFetchOk({ status: 'available', entries: [] });

    await getSkillsCatalog();

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/skills-cli/catalog',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('parses an available catalog including an entry with no sparkline or official flag', async () => {
    mockFetchOk({
      status: 'available',
      entries: [
        {
          source: 'vercel-labs/skills',
          skillId: 'find-skills',
          name: 'find-skills',
          installs: 2787493,
          weeklyInstalls: [1, 2],
          isOfficial: true,
        },
        {
          source: 'mattpocock/skills',
          skillId: 'grill-me',
          name: 'grill-me',
          installs: 732181,
          weeklyInstalls: null,
          isOfficial: false,
        },
      ],
    });

    const catalog = await getSkillsCatalog();

    expect(catalog.status).toBe('available');
    if (catalog.status !== 'available') throw new Error('expected an available catalog');
    expect(catalog.entries).toHaveLength(2);
    expect(catalog.entries[0]?.installs).toBe(2787493);
    expect(catalog.entries[1]?.weeklyInstalls).toBeNull();
  });

  it('resolves an unavailable catalog rather than throwing — Browse degrades to search-only', async () => {
    mockFetchOk({ status: 'unavailable' });

    await expect(getSkillsCatalog()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('searchSkills', () => {
  it('URL-encodes the query into ?q=', async () => {
    mockFetchOk({ entries: [] });

    await searchSkills('code review');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/skills-cli/search?q=code%20review',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns the entries array, keeping an unknown official flag null', async () => {
    mockFetchOk({
      entries: [
        {
          source: 'microsoft/playwright-cli',
          skillId: 'playwright-cli',
          name: 'playwright-cli',
          installs: 106797,
          isOfficial: null,
        },
      ],
    });

    const results = await searchSkills('playwright');

    expect(results).toHaveLength(1);
    expect(results[0]?.skillId).toBe('playwright-cli');
    expect(results[0]?.isOfficial).toBeNull();
  });

  it('a 400 from the daemon surfaces its message', async () => {
    mockFetchFail(400, { success: false, error: 'q must be at least 2 characters' });

    await expect(searchSkills('p')).rejects.toThrow('q must be at least 2 characters');
  });
});

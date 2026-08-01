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
import { getSkillsCliManifest, probeSkillsSource, installSkills, uninstallSkills, SkillsCliError } from '../skills-cli';
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

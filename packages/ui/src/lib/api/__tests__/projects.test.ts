import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Project } from '@qlan-ro/mainframe-types';
import { createProject, getProjects, removeProject } from '../projects';
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

describe('getProjects', () => {
  it('calls GET http://127.0.0.1:<port>/api/projects with the given port', async () => {
    mockFetchOk([]);

    await getProjects(31415);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects', { method: 'GET' });
  });

  it('ignores the port arg — the active daemon owns the base URL', async () => {
    mockFetchOk([]);

    await getProjects(9000);

    // apiBase ignores the passed port and uses the active daemon's baseUrl (local: 31415).
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects', { method: 'GET' });
  });
});

describe('removeProject', () => {
  it('calls DELETE http://127.0.0.1:<port>/api/projects/<id> with the given port and project id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    );

    await removeProject(31415, 'proj-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-1', { method: 'DELETE' });
  });
});

describe('createProject', () => {
  const CREATED: Project = {
    id: 'proj-new',
    name: 'gamma',
    path: '/home/user/gamma',
    createdAt: '2026-06-22T00:00:00.000Z',
    lastOpenedAt: '2026-06-22T00:00:00.000Z',
  };

  it('POSTs { path } to /api/projects with the given port and JSON headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: CREATED }),
      }),
    );

    await createProject(31415, '/home/user/gamma');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/home/user/gamma' }),
    });
  });

  it('includes the Bearer auth header and hits the remote base when the active daemon is remote', async () => {
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'Studio',
      baseUrl: 'https://studio.example.com',
      token: 'jwt-xyz',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: CREATED }),
      }),
    );

    await createProject(31415, '/srv/agent/gamma');

    expect(fetch).toHaveBeenCalledWith('https://studio.example.com/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-xyz' },
      body: JSON.stringify({ path: '/srv/agent/gamma' }),
    });
  });

  it('includes name in the body when provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: CREATED }),
      }),
    );

    await createProject(31415, '/home/user/gamma', 'Gamma');

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/home/user/gamma', name: 'Gamma' }),
    });
  });

  it('on 200 returns { project: data, alreadyExists: false }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: CREATED }),
      }),
    );

    const result = await createProject(31415, '/home/user/gamma');

    expect(result).toEqual({ project: CREATED, alreadyExists: false });
  });

  it('on 409 returns { project: data, alreadyExists: true } (already registered)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ success: false, error: 'Project already registered', data: CREATED }),
      }),
    );

    const result = await createProject(31415, '/home/user/gamma');

    expect(result).toEqual({ project: CREATED, alreadyExists: true });
  });

  it('on other non-OK throws with the body error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ success: false, error: 'path must be absolute' }),
      }),
    );

    await expect(createProject(31415, 'relative/path')).rejects.toThrow('path must be absolute');
  });

  it('on a non-OK with no parseable body throws HTTP <status>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      }),
    );

    await expect(createProject(31415, '/home/user/gamma')).rejects.toThrow('HTTP 500');
  });
});

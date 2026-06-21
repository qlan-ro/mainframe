import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Project } from '@qlan-ro/mainframe-types';
import { createProject, getProjects, removeProject } from '../projects';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_FIXTURE: Project[] = [
  {
    id: 'proj-1',
    name: 'Alpha',
    path: '/home/user/alpha',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'proj-2',
    name: 'Beta',
    path: '/home/user/beta',
    createdAt: '2026-02-01T00:00:00.000Z',
    lastOpenedAt: '2026-06-02T00:00:00.000Z',
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProjects', () => {
  it('calls GET http://127.0.0.1:<port>/api/projects with the given port', async () => {
    mockFetchOk(PROJECT_FIXTURE);

    await getProjects(31415);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects', { method: 'GET' });
  });

  it('returns the unwrapped Project[] from the ApiResponse envelope', async () => {
    mockFetchOk(PROJECT_FIXTURE);

    const result = await getProjects(31415);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'proj-1',
      name: 'Alpha',
      path: '/home/user/alpha',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result[1]).toEqual({
      id: 'proj-2',
      name: 'Beta',
      path: '/home/user/beta',
      createdAt: '2026-02-01T00:00:00.000Z',
      lastOpenedAt: '2026-06-02T00:00:00.000Z',
    });
  });

  it('uses a different port when passed', async () => {
    mockFetchOk([]);

    await getProjects(9000);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9000/api/projects', { method: 'GET' });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('database unavailable');

    await expect(getProjects(31415)).rejects.toThrow('database unavailable');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal server error' }),
      }),
    );

    await expect(getProjects(31415)).rejects.toThrow('internal server error');
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveDaemon } from '../../daemon/active-daemon';
import { request, apiBase } from '../http';

describe('http auth injection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('apiBase returns the active baseUrl, ignoring the port arg', () => {
    setActiveDaemon({ id: 'studio', kind: 'remote', label: 'S', baseUrl: 'https://studio.example.com', token: 't' });
    expect(apiBase(31500)).toBe('https://studio.example.com');
  });

  it('adds a Bearer header for a remote target', async () => {
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'S',
      baseUrl: 'https://studio.example.com',
      token: 'jwt123',
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"success":true,"data":null}', { status: 200 }));
    await request('GET', apiBase() + '/api/projects');
    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt123');
  });

  it('omits the Bearer header for a local target', async () => {
    setActiveDaemon({ id: 'local', kind: 'local', label: 'L', baseUrl: 'http://127.0.0.1:31500', token: null });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"success":true,"data":null}', { status: 200 }));
    await request('GET', apiBase() + '/api/projects');
    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBeNull();
  });
});

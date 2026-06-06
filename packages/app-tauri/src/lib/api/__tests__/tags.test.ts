import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Tag } from '@qlan-ro/mainframe-types';
import { listTags, createTag, updateTag, deleteTag, getChatTags, setChatTags } from '../tags';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const port = 31415;

const tagFixture: Tag = {
  name: 'backend',
  color: 'blue',
  createdAt: '2026-06-01T00:00:00.000Z',
};

const chatId = 'chat-abc123';

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

function mockFetchHttpError(status: number, error: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ error }),
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

describe('listTags', () => {
  it('calls GET http://127.0.0.1:31415/api/tags', async () => {
    mockFetchOk([tagFixture]);

    await listTags(port);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags', { method: 'GET' });
  });

  it('returns the unwrapped Tag[] from the ApiResponse envelope', async () => {
    mockFetchOk([tagFixture]);

    const result = await listTags(port);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'backend',
      color: 'blue',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('throws when HTTP response is not ok (status 500)', async () => {
    mockFetchHttpError(500, 'db error');

    await expect(listTags(port)).rejects.toThrow('db error');
  });
});

describe('createTag', () => {
  it('sends POST with body {"name":"backend"} when no color is given', async () => {
    mockFetchOk(tagFixture);

    await createTag(port, 'backend');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"backend"}',
    });
  });

  it('sends body {"name":"backend","color":"red"} when color is provided', async () => {
    mockFetchOk({ ...tagFixture, color: 'red' });

    await createTag(port, 'backend', 'red');

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"backend","color":"red"}',
    });
  });

  it('returns the unwrapped Tag from the ApiResponse envelope', async () => {
    mockFetchOk(tagFixture);

    const result = await createTag(port, 'backend');

    expect(result).toEqual({
      name: 'backend',
      color: 'blue',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
  });
});

describe('updateTag', () => {
  it('sends PATCH to /api/tags/:name with body {"rename":"infra"}', async () => {
    mockFetchOk({ name: 'infra', color: 'blue', createdAt: '2026-06-01T00:00:00.000Z' });

    await updateTag(port, 'backend', { rename: 'infra' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags/backend', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"rename":"infra"}',
    });
  });

  it('sends body {"color":"green"} when only color is patched', async () => {
    mockFetchOk({ name: 'backend', color: 'green', createdAt: '2026-06-01T00:00:00.000Z' });

    await updateTag(port, 'backend', { color: 'green' });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags/backend', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"color":"green"}',
    });
  });

  it('sends body {"rename":"infra","color":"green"} when both fields are patched', async () => {
    mockFetchOk({ name: 'infra', color: 'green', createdAt: '2026-06-01T00:00:00.000Z' });

    await updateTag(port, 'backend', { rename: 'infra', color: 'green' });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags/backend', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"rename":"infra","color":"green"}',
    });
  });

  it('returns the unwrapped Tag from the ApiResponse envelope', async () => {
    mockFetchOk({ name: 'infra', color: 'blue', createdAt: '2026-06-01T00:00:00.000Z' });

    const result = await updateTag(port, 'backend', { rename: 'infra' });

    expect(result).toEqual({
      name: 'infra',
      color: 'blue',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
  });
});

describe('deleteTag', () => {
  it('calls DELETE http://127.0.0.1:31415/api/tags/:name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      }),
    );

    await deleteTag(port, 'backend');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/tags/backend', { method: 'DELETE' });
  });

  it('returns void on success (204 no body — json() is not called)', async () => {
    const jsonSpy = vi.fn().mockRejectedValue(new Error('no body'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: jsonSpy,
      }),
    );

    const result = await deleteTag(port, 'backend');

    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('throws when HTTP response is not ok (404)', async () => {
    mockFetchHttpError(404, 'tag not found');

    await expect(deleteTag(port, 'backend')).rejects.toThrow('tag not found');
  });
});

describe('getChatTags', () => {
  it('calls GET http://127.0.0.1:31415/api/chats/:id/tags', async () => {
    mockFetchOk(['backend', 'frontend']);

    await getChatTags(port, chatId);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/tags', { method: 'GET' });
  });

  it('returns the unwrapped string[] from the ApiResponse envelope', async () => {
    mockFetchOk(['backend', 'frontend']);

    const result = await getChatTags(port, chatId);

    expect(result).toEqual(['backend', 'frontend']);
  });
});

describe('setChatTags', () => {
  it('sends PUT with a wrapped { tags: [...] } body (not a raw array)', async () => {
    mockFetchOk(['backend', 'infra']);

    await setChatTags(port, chatId, ['backend', 'infra']);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/tags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"tags":["backend","infra"]}',
    });
  });

  it('returns the unwrapped string[] from the ApiResponse envelope', async () => {
    mockFetchOk(['backend', 'infra']);

    const result = await setChatTags(port, chatId, ['backend', 'infra']);

    expect(result).toEqual(['backend', 'infra']);
  });

  it('sends body {"tags":[]} when the tag list is empty', async () => {
    mockFetchOk([]);

    await setChatTags(port, chatId, []);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/tags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"tags":[]}',
    });
  });
});

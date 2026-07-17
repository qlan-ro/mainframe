/**
 * todos.test.ts
 *
 * Behaviors covered (each asserting URL, method, body, and extracted field):
 *  1.  listTodos — GET with projectId query param; extracts `.todos`.
 *  2.  createTodo — POST with body; extracts `.todo`.
 *  3.  updateTodo — PATCH to /:id; extracts `.todo`.
 *  4.  moveTodo — PATCH to /:id/move with {status}; extracts `.todo`.
 *  5.  deleteTodo — DELETE /:id.
 *  6.  startTodoSession — POST /:id/start-session; returns {chatId, initialMessage}.
 *  7.  listAttachments — GET /:id/attachments; extracts `.attachments`.
 *  8.  getAttachment — GET /:id/attachments/:attachmentId; returns {data, meta}.
 *  9.  uploadAttachment — POST /:id/attachments; extracts `.attachment`.
 *  10. deleteAttachment — DELETE /:id/attachments/:attachmentId.
 *
 * 204/error handling for plugin routes is pinned once in http-plugin.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listTodos,
  createTodo,
  updateTodo,
  moveTodo,
  deleteTodo,
  startTodoSession,
  listAttachments,
  getAttachment,
  uploadAttachment,
  deleteAttachment,
  type Todo,
  type AttachmentMeta,
} from '../todos';
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

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const TODO_ID = 'todo-xyz';

const TODO_FIXTURE: Todo = {
  id: TODO_ID,
  number: 7,
  project_id: PROJECT_ID,
  title: 'Fix the login bug',
  body: 'Users cannot log in with SSO.',
  status: 'open',
  type: 'bug',
  priority: 'high',
  labels: ['auth', 'urgent'],
  assignees: ['alice'],
  milestone: 'v1.1',
  dependencies: [],
  order_index: 0,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
};

const ATTACHMENT_FIXTURE: AttachmentMeta = {
  id: 'att-1',
  filename: 'screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 204800,
  createdAt: '2026-06-01T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// fetch mock helpers — plugin routes return RAW JSON (no ApiResponse envelope)
// ---------------------------------------------------------------------------

function mockFetchPluginOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchNoContent(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }),
  );
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

// ---------------------------------------------------------------------------
// 1. listTodos
// ---------------------------------------------------------------------------

describe('listTodos', () => {
  it('calls GET with the projectId query param', async () => {
    mockFetchPluginOk({ todos: [TODO_FIXTURE] });

    await listTodos(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos?projectId=${PROJECT_ID}`, {
      method: 'GET',
    });
  });

  it('extracts and returns the .todos array from the raw body', async () => {
    mockFetchPluginOk({ todos: [TODO_FIXTURE] });

    const result = await listTodos(PORT, PROJECT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(TODO_FIXTURE);
  });

  it('encodes a projectId that contains special characters', async () => {
    mockFetchPluginOk({ todos: [] });

    await listTodos(PORT, 'proj/with spaces');

    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/todos?projectId=proj%2Fwith%20spaces`,
      { method: 'GET' },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. createTodo
// ---------------------------------------------------------------------------

describe('createTodo', () => {
  it('calls POST to the base URL with the input body', async () => {
    mockFetchPluginOk({ todo: TODO_FIXTURE });

    await createTodo(PORT, { title: 'Fix the login bug', type: 'bug', priority: 'high' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"Fix the login bug","type":"bug","priority":"high"}',
    });
  });

  it('extracts and returns the .todo field from the raw body', async () => {
    mockFetchPluginOk({ todo: TODO_FIXTURE });

    const result = await createTodo(PORT, { title: 'Fix the login bug' });

    expect(result).toEqual(TODO_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// 3. updateTodo
// ---------------------------------------------------------------------------

describe('updateTodo', () => {
  it('calls PATCH to /:id with the update body', async () => {
    const updated = { ...TODO_FIXTURE, title: 'Fix the login bug — resolved' };
    mockFetchPluginOk({ todo: updated });

    await updateTodo(PORT, TODO_ID, { title: 'Fix the login bug — resolved' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"Fix the login bug — resolved"}',
    });
  });

  it('extracts and returns the .todo field', async () => {
    const updated = { ...TODO_FIXTURE, priority: 'critical' as const };
    mockFetchPluginOk({ todo: updated });

    const result = await updateTodo(PORT, TODO_ID, { priority: 'critical' });

    expect(result.priority).toBe('critical');
    expect(result.id).toBe(TODO_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. moveTodo
// ---------------------------------------------------------------------------

describe('moveTodo', () => {
  it('calls PATCH to /:id/move with {status}', async () => {
    mockFetchPluginOk({ todo: { ...TODO_FIXTURE, status: 'in_progress' } });

    await moveTodo(PORT, TODO_ID, 'in_progress');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"status":"in_progress"}',
    });
  });

  it('extracts and returns the .todo field with updated status', async () => {
    mockFetchPluginOk({ todo: { ...TODO_FIXTURE, status: 'done' } });

    const result = await moveTodo(PORT, TODO_ID, 'done');

    expect(result.status).toBe('done');
    expect(result.id).toBe(TODO_ID);
  });
});

// ---------------------------------------------------------------------------
// 5. deleteTodo
// ---------------------------------------------------------------------------

describe('deleteTodo', () => {
  it('calls DELETE to /:id', async () => {
    mockFetchNoContent();

    await deleteTodo(PORT, TODO_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}`, {
      method: 'DELETE',
      headers: {},
    });
  });
});

// ---------------------------------------------------------------------------
// 6. startTodoSession
// ---------------------------------------------------------------------------

describe('startTodoSession', () => {
  it('calls POST to /:id/start-session with {projectId}', async () => {
    mockFetchPluginOk({ chatId: 'chat-new', initialMessage: 'Work on Fix the login bug' });

    await startTodoSession(PORT, TODO_ID, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"projectId":"${PROJECT_ID}"}`,
    });
  });

  it('returns {chatId, initialMessage} from the raw body', async () => {
    mockFetchPluginOk({ chatId: 'chat-new', initialMessage: 'Work on Fix the login bug' });

    const result = await startTodoSession(PORT, TODO_ID, PROJECT_ID);

    expect(result.chatId).toBe('chat-new');
    expect(result.initialMessage).toBe('Work on Fix the login bug');
  });
});

// ---------------------------------------------------------------------------
// 7. listAttachments
// ---------------------------------------------------------------------------

describe('listAttachments', () => {
  it('calls GET to /:id/attachments', async () => {
    mockFetchPluginOk({ attachments: [ATTACHMENT_FIXTURE] });

    await listAttachments(PORT, TODO_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/attachments`, {
      method: 'GET',
    });
  });

  it('extracts and returns the .attachments array', async () => {
    mockFetchPluginOk({ attachments: [ATTACHMENT_FIXTURE] });

    const result = await listAttachments(PORT, TODO_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(ATTACHMENT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// 8. getAttachment
// ---------------------------------------------------------------------------

describe('getAttachment', () => {
  it('calls GET to /:id/attachments/:attachmentId', async () => {
    mockFetchPluginOk({ data: 'base64data==', meta: ATTACHMENT_FIXTURE });

    await getAttachment(PORT, TODO_ID, 'att-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/attachments/att-1`,
      { method: 'GET' },
    );
  });

  it('returns {data, meta} from the raw body', async () => {
    mockFetchPluginOk({ data: 'base64data==', meta: ATTACHMENT_FIXTURE });

    const result = await getAttachment(PORT, TODO_ID, 'att-1');

    expect(result.data).toBe('base64data==');
    expect(result.meta).toEqual(ATTACHMENT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// 9. uploadAttachment
// ---------------------------------------------------------------------------

describe('uploadAttachment', () => {
  it('calls POST to /:id/attachments with the file body', async () => {
    mockFetchPluginOk({ attachment: ATTACHMENT_FIXTURE });

    await uploadAttachment(PORT, TODO_ID, {
      filename: 'screenshot.png',
      mimeType: 'image/png',
      data: 'base64data==',
      sizeBytes: 204800,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"filename":"screenshot.png","mimeType":"image/png","data":"base64data==","sizeBytes":204800}',
    });
  });

  it('extracts and returns the .attachment field', async () => {
    mockFetchPluginOk({ attachment: ATTACHMENT_FIXTURE });

    const result = await uploadAttachment(PORT, TODO_ID, {
      filename: 'screenshot.png',
      mimeType: 'image/png',
      data: 'base64data==',
      sizeBytes: 204800,
    });

    expect(result).toEqual(ATTACHMENT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// Missing-field validation (expectField integration)
// ---------------------------------------------------------------------------

describe('listTodos — throws when .todos field is missing', () => {
  it('throws when the response body does not contain .todos', async () => {
    mockFetchPluginOk({ data: [] });

    await expect(listTodos(PORT, PROJECT_ID)).rejects.toThrow('Plugin response missing field "todos"');
  });
});

describe('createTodo — throws when .todo field is missing', () => {
  it('throws when the response body does not contain .todo', async () => {
    mockFetchPluginOk({ data: {} });

    await expect(createTodo(PORT, { title: 'Test' })).rejects.toThrow('Plugin response missing field "todo"');
  });
});

describe('uploadAttachment — throws when .attachment field is missing', () => {
  it('throws when the response body does not contain .attachment', async () => {
    mockFetchPluginOk({ data: {} });

    await expect(
      uploadAttachment(PORT, TODO_ID, {
        filename: 'test.png',
        mimeType: 'image/png',
        data: 'abc',
        sizeBytes: 100,
      }),
    ).rejects.toThrow('Plugin response missing field "attachment"');
  });
});

// ---------------------------------------------------------------------------
// 10. deleteAttachment
// ---------------------------------------------------------------------------

describe('deleteAttachment', () => {
  it('calls DELETE to /:id/attachments/:attachmentId', async () => {
    mockFetchNoContent();

    await deleteAttachment(PORT, TODO_ID, 'att-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/todos/${TODO_ID}/attachments/att-1`,
      { method: 'DELETE', headers: {} },
    );
  });
});

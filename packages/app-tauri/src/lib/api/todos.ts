/**
 * Todos plugin REST client.
 *
 * Plugin routes return RAW JSON bodies (NOT the `ApiResponse<T>` envelope) —
 * use `requestPlugin`/`requestPluginNoContent`, not `request`.
 *
 * Base: /api/plugins/todos/todos
 */
import { apiBase, requestPlugin, requestPluginNoContent } from './http';

// ── Domain types (not exported from @qlan-ro/mainframe-types — defined locally) ──

export type TodoStatus = 'open' | 'in_progress' | 'done';
export type TodoType =
  | 'bug'
  | 'feature'
  | 'enhancement'
  | 'documentation'
  | 'question'
  | 'wont_fix'
  | 'duplicate'
  | 'invalid';
export type TodoPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Todo {
  id: string;
  number: number;
  project_id: string;
  title: string;
  body: string;
  status: TodoStatus;
  type: TodoType;
  priority: TodoPriority;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  dependencies: number[];
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTodoInput {
  projectId?: string;
  title: string;
  body?: string;
  status?: TodoStatus;
  type?: TodoType;
  priority?: TodoPriority;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
  dependencies?: number[];
}

export type UpdateTodoInput = Partial<CreateTodoInput>;

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

// ── URL helper ──

const base = (port: number): string => `${apiBase(port)}/api/plugins/todos/todos`;

// ── API functions ──

export const listTodos = async (port: number, projectId: string): Promise<Todo[]> =>
  (await requestPlugin<{ todos: Todo[] }>('GET', `${base(port)}?projectId=${encodeURIComponent(projectId)}`)).todos;

export const createTodo = async (port: number, input: CreateTodoInput): Promise<Todo> =>
  (await requestPlugin<{ todo: Todo }>('POST', base(port), input)).todo;

export const updateTodo = async (port: number, id: string, input: UpdateTodoInput): Promise<Todo> =>
  (await requestPlugin<{ todo: Todo }>('PATCH', `${base(port)}/${encodeURIComponent(id)}`, input)).todo;

export const moveTodo = async (port: number, id: string, status: TodoStatus): Promise<Todo> =>
  (await requestPlugin<{ todo: Todo }>('PATCH', `${base(port)}/${encodeURIComponent(id)}/move`, { status })).todo;

export const deleteTodo = (port: number, id: string): Promise<void> =>
  requestPluginNoContent('DELETE', `${base(port)}/${encodeURIComponent(id)}`);

export const startTodoSession = (
  port: number,
  id: string,
  projectId: string,
): Promise<{ chatId: string; initialMessage: string }> =>
  requestPlugin<{ chatId: string; initialMessage: string }>(
    'POST',
    `${base(port)}/${encodeURIComponent(id)}/start-session`,
    { projectId },
  );

export const listAttachments = async (port: number, id: string): Promise<AttachmentMeta[]> =>
  (await requestPlugin<{ attachments: AttachmentMeta[] }>('GET', `${base(port)}/${encodeURIComponent(id)}/attachments`))
    .attachments;

export const getAttachment = (
  port: number,
  id: string,
  attachmentId: string,
): Promise<{ data: string; meta: AttachmentMeta }> =>
  requestPlugin<{ data: string; meta: AttachmentMeta }>(
    'GET',
    `${base(port)}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
  );

export const uploadAttachment = async (
  port: number,
  id: string,
  file: { filename: string; mimeType: string; data: string; sizeBytes: number },
): Promise<AttachmentMeta> =>
  (
    await requestPlugin<{ attachment: AttachmentMeta }>(
      'POST',
      `${base(port)}/${encodeURIComponent(id)}/attachments`,
      file,
    )
  ).attachment;

export const deleteAttachment = (port: number, id: string, attachmentId: string): Promise<void> =>
  requestPluginNoContent(
    'DELETE',
    `${base(port)}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
  );

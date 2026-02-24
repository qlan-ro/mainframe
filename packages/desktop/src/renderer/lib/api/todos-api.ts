import { API_BASE } from './http';

const BASE = `${API_BASE}/api/plugins/todos`;

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
}

export type UpdateTodoInput = Partial<CreateTodoInput>;

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`Todos API error ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const todosApi = {
  list: (projectId: string) =>
    api<{ todos: Todo[] }>(`/todos?projectId=${encodeURIComponent(projectId)}`).then((r) => r.todos),

  create: (input: CreateTodoInput) =>
    api<{ todo: Todo }>('/todos', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.todo),

  update: (id: string, input: UpdateTodoInput) =>
    api<{ todo: Todo }>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(input) }).then((r) => r.todo),

  move: (id: string, status: TodoStatus) =>
    api<{ todo: Todo }>(`/todos/${id}/move`, { method: 'PATCH', body: JSON.stringify({ status }) }).then((r) => r.todo),

  remove: (id: string) => api<void>(`/todos/${id}`, { method: 'DELETE' }),

  startSession: (id: string, projectId: string) =>
    api<{ chatId: string; initialMessage: string }>(`/todos/${id}/start-session`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),

  listAttachments: (id: string) =>
    api<{ attachments: AttachmentMeta[] }>(`/todos/${id}/attachments`).then((r) => r.attachments),

  uploadAttachment: (id: string, file: { filename: string; mimeType: string; data: string; sizeBytes: number }) =>
    api<{ attachment: AttachmentMeta }>(`/todos/${id}/attachments`, {
      method: 'POST',
      body: JSON.stringify(file),
    }).then((r) => r.attachment),

  deleteAttachment: (id: string, attachmentId: string) =>
    api<void>(`/todos/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
};

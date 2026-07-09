/**
 * Minimal subset of the daemon chat REST API needed for Phase 1.
 * All routes are unauthenticated when called from localhost (daemon auth middleware
 * isLocalhost() bypass confirmed in packages/core/src/server/middleware/auth.ts).
 */
import type {
  Chat,
  ChatHistoryPayload,
  SessionTuning,
  ExecutionMode,
  PermissionMode,
  ControlRequest,
} from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

/** Body for PATCH /api/chats/:id/config — adapter / model / permission / plan. */
export interface ChatConfigPatch {
  adapterId?: string;
  model?: string;
  permissionMode?: ExecutionMode;
  planMode?: boolean;
}

/**
 * Set adapter / model / permission-mode / plan-mode (the config the daemon
 * applies to the next run). Mirrors the desktop `updateChatConfig` REST call.
 * Returns the updated chat.
 */
export const setChatConfig = (port: number, chatId: string, body: ChatConfigPatch): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/config`, body);

/** History + transcript presence — `transcriptMissing` tells an empty thread from a deleted transcript. */
export const getChatMessages = (port: number, chatId: string): Promise<ChatHistoryPayload> =>
  request<ChatHistoryPayload>('GET', `${apiBase(port)}/api/chats/${chatId}/messages`);

// ── Degraded-chat recovery (missing transcript / missing worktree) ──────────

/** Forget the dead CLI session; the next send spawns fresh in the same chat row. */
export const continueChatHere = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/continue-here`);

/** Re-add the deleted worktree at its stored path from the stored branch (409 when the branch is gone). */
export const recreateChatWorktree = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/recreate-worktree`);

/** Detach the chat from its deleted worktree and rebind it to the project root. */
export const continueChatInProjectRoot = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/continue-in-project-root`);

/** The chat record (model, effort, planMode, permissionMode, adapterId, isRunning, …). */
export const getChat = (port: number, chatId: string): Promise<Chat> =>
  request<Chat>('GET', `${apiBase(port)}/api/chats/${chatId}`);

/**
 * The chat's currently-pending permission (control_request), or null. Used to
 * restore the permission gate on load/reconnect — the daemon does NOT re-emit
 * `permission.requested` on subscribe/resume, so a live event missed during a
 * disconnect must be recovered via this REST read.
 */
export const getPendingPermission = (port: number, chatId: string): Promise<ControlRequest | null> =>
  request<ControlRequest | null>('GET', `${apiBase(port)}/api/chats/${chatId}/pending-permission`);

/**
 * Persist a tuning patch (effort + fast/ultracode/adaptiveThinking — the only
 * REST-settable config). Tri-state: undefined skips, null clears, value sets.
 * Returns the updated chat.
 */
export const setChatTuning = (port: number, chatId: string, tuning: SessionTuning): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/tuning`, tuning);

export const resumeChat = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/resume`);

/** Mark the chat's workspace trusted in ~/.claude.json (silences the untrusted-workspace advisory). */
export const trustWorkspace = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/trust-workspace`);

export const interruptChat = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/interrupt`);

/**
 * Edit a queued message's text. The message was already forwarded to the CLI,
 * which holds it in its own FIFO queue and may consume it mid-turn or fold it
 * into the next turn — this races that consumption and can no-op if the CLI
 * grabs the message first.
 */
export const editQueuedMessage = (port: number, chatId: string, messageId: string, content: string): Promise<void> =>
  requestEmpty('PATCH', `${apiBase(port)}/api/chats/${chatId}/queue/${messageId}`, { content });

/** Cancel a queued message before the CLI consumes it (races consumption; a lost race is silent). */
export const cancelQueuedMessage = (port: number, chatId: string, messageId: string): Promise<void> =>
  requestEmpty('DELETE', `${apiBase(port)}/api/chats/${chatId}/queue/${messageId}`);

/** Full (untruncated) output for a tool call, fetched on demand for long results. */
export async function getToolResultContent(port: number, chatId: string, toolUseId: string): Promise<string> {
  const { content } = await request<{ content: string }>(
    'GET',
    `${apiBase(port)}/api/chats/${chatId}/tool-result/${toolUseId}`,
  );
  return content;
}

// ── Sessions sidebar additions ─────────────────────────────────────────────

export interface CreateChatBody {
  projectId: string;
  adapterId: string;
  model?: string;
  /**
   * Draft permission mode. Accepts `'plan'` (the draft picker can select it);
   * the daemon route maps it onto the new chat. Wider than {@link ExecutionMode}
   * to carry the picker's full {@link PermissionMode} intent.
   */
  permissionMode?: PermissionMode;
  worktreePath?: string;
  branchName?: string;
}

/**
 * List all chats, with optional server-side filters.
 * Tags and synthetic are comma-joined single params: ?tags=a,b&synthetic=c,d
 * (daemon splits on commas; repeated params would become an array and 400)
 */
export function listChats(
  port: number,
  q?: { project?: string; tags?: string[]; synthetic?: string[] },
): Promise<Chat[]> {
  const url = new URL(`${apiBase(port)}/api/chats`);
  if (q?.project !== undefined) url.searchParams.set('project', q.project);
  if (q?.tags?.length) url.searchParams.set('tags', q.tags.join(','));
  if (q?.synthetic?.length) url.searchParams.set('synthetic', q.synthetic.join(','));
  return request<Chat[]>('GET', url.toString());
}

/** Create a new daemon chat session. */
export const createChat = (port: number, body: CreateChatBody): Promise<Chat> =>
  request<Chat>('POST', `${apiBase(port)}/api/chats`, body);

/** Rename a chat (PATCH /api/chats/:id/title). */
export const renameChat = (port: number, chatId: string, title: string): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/title`, { title });

/** Pin or unpin a chat (PATCH /api/chats/:id/pinned). */
export const pinChat = (port: number, chatId: string, pinned: boolean): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/pinned`, { pinned });

/**
 * Archive a chat.
 * deleteWorktree defaults to TRUE server-side — only send the query param when false.
 */
export function archiveChat(port: number, chatId: string, deleteWorktree: boolean): Promise<void> {
  const base = `${apiBase(port)}/api/chats/${chatId}/archive`;
  const url = deleteWorktree ? base : `${base}?deleteWorktree=false`;
  return requestEmpty('POST', url);
}

/** Unarchive a chat (POST /api/chats/:id/unarchive). */
export const unarchiveChat = (port: number, chatId: string): Promise<Chat> =>
  request<Chat>('POST', `${apiBase(port)}/api/chats/${chatId}/unarchive`);

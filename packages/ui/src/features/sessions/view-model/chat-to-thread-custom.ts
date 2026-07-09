/**
 * Canonical type definitions for the sessions sidebar view-model, plus the
 * pure Chat → RemoteThreadMetadata projection.
 *
 * SessionItem and SessionCustom are defined ONCE here. All other phases import
 * from this file. No other file re-declares them.
 *
 * unread is NOT a field of SessionCustom. It is client-only store state
 * injected at call sites (e.g. deriveSessionBadge, attentionCount). This
 * keeps the mapper side-effect-free.
 *
 * The return type satisfies RemoteThreadMetadata (from @assistant-ui/react)
 * at the call site; we do not import it here to keep this module aui-free.
 */
import type { Chat } from '@qlan-ro/mainframe-types';

export interface SessionCustom {
  projectId: string;
  adapterId: string;
  /** The agent CLI's own session id (Claude/Codex `--resume` id), if the session has started. */
  claudeSessionId?: string;
  tags: string[];
  pinned: boolean;
  status: Chat['status'];
  /** Always present — defaults to 'idle'. NonNullable<Chat['displayStatus']>. */
  displayStatus: NonNullable<Chat['displayStatus']>;
  /** True only when displayStatus === 'waiting'. List-level pending badge (D8). */
  hasPending: boolean;
  detectedPrs: NonNullable<Chat['detectedPrs']>;
  worktreePath?: string;
  worktreeMissing: boolean;
  /** True when the CLI's transcript file for this session was deleted from disk. */
  transcriptMissing: boolean;
  /** Worktree branch — read by the shell MainToolbar identity (additive). */
  branchName?: string;
  updatedAt: number;
}

export interface SessionItem {
  id: string;
  remoteId?: string;
  title?: string;
  /** 'regular' for all non-archived chats; 'archived' for archived ones. */
  status: 'regular' | 'archived';
  custom: SessionCustom;
}

export interface ThreadCustomResult {
  status: 'regular' | 'archived';
  remoteId: string;
  externalId: undefined;
  title?: string;
  custom: SessionCustom;
}

export function chatToThreadCustom(chat: Chat): ThreadCustomResult {
  const displayStatus: NonNullable<Chat['displayStatus']> = chat.displayStatus ?? 'idle';
  const custom: SessionCustom = {
    projectId: chat.projectId,
    adapterId: chat.adapterId,
    claudeSessionId: chat.claudeSessionId,
    tags: chat.tags ?? [],
    pinned: chat.pinned ?? false,
    status: chat.status,
    displayStatus,
    hasPending: displayStatus === 'waiting',
    detectedPrs: chat.detectedPrs ?? [],
    worktreePath: chat.worktreePath,
    worktreeMissing: chat.worktreeMissing ?? false,
    transcriptMissing: chat.transcriptMissing ?? false,
    branchName: chat.branchName,
    updatedAt: new Date(chat.updatedAt).getTime(),
  };
  return {
    status: chat.status === 'archived' ? 'archived' : 'regular',
    remoteId: chat.id,
    externalId: undefined,
    title: chat.title,
    custom,
  };
}

/**
 * Canonical assistant-ui thread-entry → SessionItem seam.
 *
 * assistant-ui exposes the thread list through TWO containers with the same
 * per-entry shape but different wrappers:
 *   - the legacy runtime `ThreadListState` (useAssistantRuntime().threads.getState):
 *     `threadIds` + a `threadItems` Record keyed by id;
 *   - the store-scope `ThreadsState` (useAuiState((s) => s.threads)):
 *     `threadItems` as an ordered array.
 * Both carry per-entry `{ id, remoteId, status, title?, custom? }` where `custom`
 * is typed `Record<string, unknown>`. Our chatToThreadCustom projection always
 * writes a SessionCustom into that slot (see chats-remote-adapter), so the
 * narrowing is sound. This module is the ONE place we narrow `custom` and the ONE
 * place that maps a thread entry to a SessionItem.
 *
 * The structural types below mirror the real `@assistant-ui/core` shapes (verified
 * against core@0.2.10) WITHOUT importing aui, keeping this module dependency-free;
 * the live aui state is assignable to them.
 */
export interface ThreadListEntry {
  id: string;
  remoteId?: string;
  title?: string;
  status: string;
  custom?: Record<string, unknown> | undefined;
}

/** Runtime-shaped state: ordered ids + a Record of entries. */
export interface ThreadListRecordState {
  threadIds: readonly string[];
  /** Separate bucket for archived threads — assistant-ui keeps them here, not in threadIds. */
  archivedThreadIds?: readonly string[];
  threadItems: Readonly<Record<string, ThreadListEntry>>;
}

/**
 * The single narrowing of the aui-boundary `custom` to our SessionCustom.
 * Callers filter out custom-less entries (the transient new/draft thread carries
 * no `custom`), so a defined `Record<string, unknown>` is the only input here.
 */
function narrowSessionCustom(custom: Record<string, unknown>): SessionCustom {
  return custom as unknown as SessionCustom;
}

/**
 * Narrow a thread-list item's boundary `custom` to SessionCustom, or undefined
 * for the custom-less new/draft thread. Internal — active-item reads go through
 * activeSessionCustom below, which also resolves the freshest entry.
 */
function sessionCustomOf(custom: Record<string, unknown> | undefined): SessionCustom | undefined {
  return custom == null ? undefined : narrowSessionCustom(custom);
}

/**
 * Freshest custom for the ACTIVE thread-list item.
 *
 * A thread created this app-run keeps its `__LOCALID_*` mapping id for life
 * (no id-flip), but aui's `threads.reload()` re-derives custom only under a
 * NEW entry keyed by the remoteId — the `__LOCALID_*` entry's custom is never
 * written again. Reading `s.threadListItem.custom` alone therefore goes
 * permanently stale on such threads (e.g. a worktree join never reaches the
 * toolbar). Prefer the remoteId-keyed list entry, which every reload refreshes.
 */
export function activeSessionCustom(
  item: ThreadListEntry | undefined,
  threadItems: readonly ThreadListEntry[],
): SessionCustom | undefined {
  if (!item) return undefined;
  const fresh = item.remoteId == null ? undefined : threadItems.find((t) => t.id === item.remoteId);
  return sessionCustomOf(fresh?.custom ?? item.custom);
}

/** A thread entry that carries a materialized `custom` (i.e. a real session). */
type SessionThreadEntry = ThreadListEntry & { custom: Record<string, unknown> };

/**
 * True only for entries backed by a daemon chat. The native thread list ALWAYS
 * contains the transient new/draft thread (id `__LOCALID_*`, status 'new') which
 * has no `custom` because no chat exists yet; it is not a session list row.
 * Dropping it here is the single source that guarantees every emitted SessionItem
 * has a real SessionCustom, so all downstream `.custom.X` accesses are safe.
 */
function hasSessionCustom(entry: ThreadListEntry): entry is SessionThreadEntry {
  return entry.custom != null;
}

/** Map one aui thread-list entry to a SessionItem (status + custom narrowed once). */
function threadEntryToSessionItem(entry: SessionThreadEntry): SessionItem {
  return {
    id: entry.id,
    remoteId: entry.remoteId,
    title: entry.title ?? undefined,
    status: entry.status === 'archived' ? 'archived' : 'regular',
    custom: narrowSessionCustom(entry.custom),
  };
}

/**
 * Project an already-ordered array of thread entries (the store-scope
 * `s.threads.threadItems`) to SessionItem[]. Drops the custom-less new/draft
 * thread before mapping.
 *
 * NOTE: the store-scope `s.threads.threadItems` is the FULL thread map — it
 * contains BOTH regular and archived threads (aui splits them only into the
 * `threadIds` / `archivedThreadIds` id buckets, never in `threadItems`). So this
 * projection includes archived sessions; callers that want the visible list
 * (which must exclude archived) use `regularThreadItemsToSessionItems` instead.
 * Callers that need archived visibility (e.g. the archived-active fallback in
 * use-session-list-router) keep using this one.
 */
export function threadItemsToSessionItems(entries: readonly ThreadListEntry[]): SessionItem[] {
  return entries.filter(hasSessionCustom).map(threadEntryToSessionItem);
}

/**
 * Regular (non-archived) sessions only — the source for the sidebar list and any
 * project/attention aggregation over the visible set. Archived sessions live in
 * the ArchivedSessionsDialog, never the main list; including them here is the
 * archived-leak bug that surfaces when projecting the full store-scope
 * `threadItems` array (which the legacy `threadListStateToSessionItems` avoided
 * by walking the regular-only `threadIds` bucket).
 */
export function regularThreadItemsToSessionItems(entries: readonly ThreadListEntry[]): SessionItem[] {
  return entries
    .filter(hasSessionCustom)
    .filter((entry) => entry.status !== 'archived')
    .map(threadEntryToSessionItem);
}

/**
 * Project only the archived threads from the runtime ThreadListState.
 *
 * assistant-ui keeps archived threads in `archivedThreadIds` (a separate bucket
 * from `threadIds` which holds only active threads). Walking `threadIds` for
 * archived entries is always empty; this helper walks the correct bucket.
 */
export function archivedThreadListStateToSessionItems(state: ThreadListRecordState): SessionItem[] {
  const ids = state.archivedThreadIds ?? [];
  return ids
    .map((id) => state.threadItems[id])
    .filter((entry): entry is ThreadListEntry => entry != null)
    .filter(hasSessionCustom)
    .map(threadEntryToSessionItem);
}

/**
 * Project the runtime `ThreadListState` (Record + threadIds) to an ordered
 * SessionItem[] — the source for the sidebar list. Walks `threadIds` (the
 * canonical order) and resolves each via the `threadItems` Record, skipping ids
 * without a materialized entry and the custom-less new/draft thread.
 */
export function threadListStateToSessionItems(state: ThreadListRecordState): SessionItem[] {
  return state.threadIds
    .map((id) => state.threadItems[id])
    .filter((entry): entry is ThreadListEntry => entry != null)
    .filter(hasSessionCustom)
    .map(threadEntryToSessionItem);
}

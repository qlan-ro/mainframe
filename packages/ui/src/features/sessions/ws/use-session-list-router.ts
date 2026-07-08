/**
 * useSessionListRouter — React glue around SessionListRouter (Task 7.3).
 *
 * Must run UNDER <AssistantRuntimeProvider> so it can reach the live thread
 * list + active thread. Applies the cross-cutting list side-effects (fix B9):
 *
 *   chat.created / chat.ended           → runtime.threads.reload()
 *   chat.updated                        → runtime.threads.reload() (idempotent;
 *                                          re-derives custom from the daemon)
 *   chat.notification / permission(notify) → unread.markUnread()
 *
 * On every active-thread change it also: clears the active chat's unread,
 * clears the project filter when the activated chat crosses projects, and
 * falls back to the most-recently-updated non-archived thread (desktop parity,
 * preferring the active project filter's sessions) when the active chat was
 * archived out from under us (blank surface if none remain).
 *
 * On boot it auto-opens the most-recently-updated session ONCE (desktop parity,
 * renderer `useAppInit`), so the app never starts on the empty new-thread picker
 * when sessions exist. Fires only while the user is still on the boot draft —
 * never yanks them off a thread they opened or a new chat they started.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { useUnreadStore } from '../../../store/unread-store';
import { useSessionFilters } from '../../../store/session-filters';
import { useLayoutStore } from '../../../store/layout';
import { useLastSessionStore } from '../../../store/last-session';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { threadItemsToSessionItems } from '../view-model/chat-to-thread-custom';
import { pickInitialSession } from '../view-model/initial-session';
import { pickArchiveFallback } from '../view-model/session-fallback';
import { createSessionListRouter } from './session-list-router';

/** Persist the newly-active session (boot restore + per-project + workspace layout). */
function rememberActiveSession(active: SessionItem | undefined): void {
  if (active?.remoteId == null) return;
  useLastSessionStore.getState().setLastSessionId(active.remoteId);
  if (active.custom?.projectId != null) {
    useLastSessionStore.getState().setLastForProject(active.custom.projectId, active.remoteId);
  }
  // Follow the active session with its remembered workspace layout, keyed by the
  // stable daemon chat id. Skipped for the __LOCALID_* draft (no remoteId yet).
  useLayoutStore.getState().setActiveSession(active.remoteId);
}

/** Clear the project filter when the activated chat belongs to a different project. */
function clearFilterOnCrossProject(active: SessionItem | undefined): void {
  const { filterProjectId, setFilterProjectId } = useSessionFilters.getState();
  const projectId = active?.custom?.projectId;
  if (filterProjectId != null && projectId != null && projectId !== filterProjectId) {
    setFilterProjectId(null);
  }
}

export function useSessionListRouter(): void {
  const runtime = useAssistantRuntime();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Select the stable store-scope threadItems array; project to SessionItem[]
  // outside the selector (a fresh array would loop useAuiState's Object.is).
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const items = useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);

  // Keep a ref so the router callback (created once in [runtime] effect) can
  // read the current active thread id without closing over a stale value.
  const activeChatIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const active = mainThreadId == null ? undefined : items.find((t) => t.id === mainThreadId);
    activeChatIdsRef.current = new Set(
      [mainThreadId ?? undefined, active?.id, active?.remoteId].filter((id): id is string => id != null),
    );
  }, [items, mainThreadId]);

  // Static WS → list wiring; created once, disposed on unmount.
  useEffect(() => {
    // Coalesce reload bursts. `chat.updated` fires on cost/token churn during a
    // run (and now on every tuning PATCH), and reload() re-runs the WHOLE thread
    // list — so an undebounced per-event call is an O(events) refetch storm.
    // Leading-edge: the first event reloads immediately (a new/ended chat shows
    // up at once), then a trailing window collapses the burst into one reload.
    let cooling: ReturnType<typeof setTimeout> | null = null;
    let trailing = false;
    const scheduleReload = (): void => {
      if (cooling != null) {
        trailing = true;
        return;
      }
      void runtime.threads.reload();
      cooling = setTimeout(() => {
        cooling = null;
        if (trailing) {
          trailing = false;
          scheduleReload();
        }
      }, 200);
    };

    const router = createSessionListRouter(daemonWs, {
      onReload: scheduleReload,
      onChatUpdated: (_chat: Chat) => scheduleReload(),
      onMarkUnread: (id) => {
        // Skip marking unread when the notification is for the active thread —
        // the active-thread effect already clears unread on focus, so marking
        // it here would leave a stale dot until the next thread switch.
        if (activeChatIdsRef.current.has(id)) return;
        useUnreadStore.getState().markUnread(id);
      },
    });
    return () => {
      if (cooling != null) clearTimeout(cooling);
      router.dispose();
    };
  }, [runtime]);

  // Active-thread side-effects: unread clear, cross-project filter clear, and the
  // archived-active fallback. `lastActiveRef` dedupes the once-per-activation work;
  // `prevRealActiveRef` remembers the last non-draft thread so an archive-induced
  // bump onto an empty draft (redirect) is told apart from a deliberate New (stay).
  const lastActiveRef = useRef<string | null>(null);
  const prevRealActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (mainThreadId == null) return;
    const active = items.find((t) => t.id === mainThreadId);
    const onDraft = active == null || mainThreadId.startsWith('__LOCALID_');

    // Desktop parity: land on the last-used (else most-recent) non-archived session,
    // respecting the active project filter. pickArchiveFallback skips archived items.
    const fallback = (): string | null =>
      pickArchiveFallback(
        items,
        useSessionFilters.getState().filterProjectId,
        useLastSessionStore.getState().lastSessionId,
      );

    if (onDraft) {
      // Archive-induced empty state: aui `switchToNewThread()`s off the archived
      // thread, so we land on a fresh draft rather than staying on the (now
      // archived) session. If the real thread we just left is now archived, redirect
      // to a fallback. A deliberate New leaves that thread 'regular', so it stays.
      const leftItem = items.find((t) => t.id === prevRealActiveRef.current);
      if (leftItem?.status === 'archived') {
        const target = fallback();
        if (target != null) {
          prevRealActiveRef.current = null;
          runtime.threads.switchToThread(target);
        }
      }
      return;
    }
    if (active == null) return; // unreachable (onDraft covers it) — narrows for TS

    // Defensive: aui usually switches away first, but if the active thread itself
    // is archived out from under us, fall back the same way.
    if (active.status === 'archived') {
      const target = fallback();
      if (target != null) runtime.threads.switchToThread(target);
      return;
    }

    prevRealActiveRef.current = mainThreadId;
    if (mainThreadId === lastActiveRef.current) return;
    lastActiveRef.current = mainThreadId;

    const unreadStore = useUnreadStore.getState();
    unreadStore.clearUnread(mainThreadId);
    if (active.remoteId != null && active.remoteId !== mainThreadId) unreadStore.clearUnread(active.remoteId);
    rememberActiveSession(active);
    clearFilterOnCrossProject(active);
  }, [mainThreadId, items, runtime]);

  // Boot auto-select: open a session once the list first loads, so the app doesn't
  // land on the empty new-thread picker. Prefers the last session open before the
  // app closed (persisted by daemon chat id), falling back to the most-recent one
  // when it's gone or archived. One-shot — consumed on the first non-empty list —
  // and only while the user is still on the boot draft (mainThreadId null or a
  // __LOCALID_* new thread), so it never overrides a thread the user has already
  // opened or a new chat they deliberately started.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current || items.length === 0) return;
    didAutoSelectRef.current = true;

    const onBootDraft = mainThreadId == null || mainThreadId.startsWith('__LOCALID_');
    if (!onBootDraft) return;

    const target = pickInitialSession(items, useLastSessionStore.getState().lastSessionId);
    if (target != null && target !== mainThreadId) {
      runtime.threads.switchToThread(target);
    }
  }, [items, mainThreadId, runtime]);

  // GC: prune persisted layout entries for sessions no longer in the thread list.
  // Guard: only when the list is non-empty to avoid wiping everything before first load.
  // Uses remoteId (the daemon's chat.id) — the key used by setActiveSession.
  useEffect(() => {
    if (items.length === 0) return;
    const validIds = new Set(items.map((t) => t.remoteId).filter((id): id is string => id != null));
    useLayoutStore.getState().pruneSessions(validIds);
  }, [items]);
}

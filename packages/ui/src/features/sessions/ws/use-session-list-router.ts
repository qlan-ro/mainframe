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
import { threadItemsToSessionItems } from '../view-model/chat-to-thread-custom';
import { pickInitialSession } from '../view-model/initial-session';
import { createSessionListRouter } from './session-list-router';

export function useSessionListRouter(): void {
  const runtime = useAssistantRuntime();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Select the stable store-scope threadItems array; project to SessionItem[]
  // outside the selector (a fresh array would loop useAuiState's Object.is).
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const items = useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);

  // Keep a ref so the router callback (created once in [runtime] effect) can
  // read the current active thread id without closing over a stale value.
  const mainThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    mainThreadIdRef.current = mainThreadId ?? null;
  }, [mainThreadId]);

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
        if (id === mainThreadIdRef.current) return;
        useUnreadStore.getState().markUnread(id);
      },
    });
    return () => {
      if (cooling != null) clearTimeout(cooling);
      router.dispose();
    };
  }, [runtime]);

  // Active-thread side-effects: unread clear, cross-project filter clear,
  // archived-active fallback. Guarded so each fires once per active change.
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (mainThreadId == null) return;
    const active = items.find((t) => t.id === mainThreadId);

    if (active != null && active.status === 'archived') {
      // Desktop parity: fall back to the most recently USED session, not the
      // first in list order. pickInitialSession ranks by custom.updatedAt and
      // skips archived items (including this one), so it can't re-pick the active.
      // Respect the active project filter: prefer the newest session within the
      // filtered project; only when that project has none left widen to all
      // sessions (the cross-project effect below then clears the empty filter).
      const { filterProjectId } = useSessionFilters.getState();
      const inProject = filterProjectId != null ? items.filter((t) => t.custom.projectId === filterProjectId) : items;
      const fallback = pickInitialSession(inProject) ?? pickInitialSession(items);
      if (fallback != null) runtime.threads.switchToThread(fallback);
      return;
    }

    if (mainThreadId === lastActiveRef.current) return;
    lastActiveRef.current = mainThreadId;

    useUnreadStore.getState().clearUnread(mainThreadId);

    // Remember the open session (by stable daemon chat id) so the next boot can
    // restore it. Skip the new-thread draft, which has no backing chat yet.
    if (active?.remoteId != null) {
      useLastSessionStore.getState().setLastSessionId(active.remoteId);
      if (active.custom?.projectId != null) {
        useLastSessionStore.getState().setLastForProject(active.custom.projectId, active.remoteId);
      }

      // Follow the active session with its remembered workspace layout (surface
      // placement + Run panes), keyed by the stable daemon chat id — same key as
      // pruneSessions above. Skip while on the __LOCALID_* draft: it has no
      // remoteId (no backing chat yet), so there's nothing to key a workspace
      // off; the previously active session's layout stays on screen until a
      // real session is activated.
      useLayoutStore.getState().setActiveSession(active.remoteId);
    }

    const { filterProjectId, setFilterProjectId } = useSessionFilters.getState();
    const projectId = active?.custom?.projectId;
    if (filterProjectId != null && projectId != null && projectId !== filterProjectId) {
      setFilterProjectId(null);
    }
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

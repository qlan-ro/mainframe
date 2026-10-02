/**
 * new-thread-switch-pending — tracks whether a user-initiated New-session
 * switch is still in flight (todo #375).
 *
 * assistant-ui's `RemoteThreadListThreadListRuntimeCore` cancels a pending
 * `switchToNewThread()`/`switchToThread()` the instant a NEWER switch starts:
 * `_startSwitchToThread`/`_startSwitchToNewThread` bump `_switchGeneration`
 * up front, and the superseded task's own generation check later just
 * `return`s without rejecting — so the superseded call's promise still
 * resolves, as if it had succeeded (`@assistant-ui/core@0.3.12`
 * `src/react/runtimes/RemoteThreadListThreadListRuntimeCore.tsx`).
 *
 * `useSessionListRouter`'s own automatic selections (first-send adoption,
 * the draft-handoff fallback, boot auto-select) call `threads.switchToThread`
 * from a plain effect and can run while a user-initiated New is still
 * awaiting `switchToNewThread()` / `waitForSwitchedDraft`'s activation poll —
 * silently cancelling it and producing the "Couldn't open a new session"
 * toast (todo #375's confirmed race).
 *
 * A counter, not a boolean: two overlapping New triggers each hold their own
 * claim via `beginNewThreadSwitch()`'s returned release function, so the
 * first trigger's release can never flip the flag off while a second one is
 * still pending. The release is idempotent — safe to call more than once,
 * defensively against a caller's own retry/finally ordering.
 */
import { create } from 'zustand';

interface NewThreadSwitchPendingState {
  count: number;
}

/** Exported (not just its reads) so tests can reset it directly, same as the sibling stores in this directory. */
export const useNewThreadSwitchPending = create<NewThreadSwitchPendingState>(() => ({ count: 0 }));

/** Claims a pending-switch slot; returns an idempotent release function. */
export function beginNewThreadSwitch(): () => void {
  useNewThreadSwitchPending.setState((s) => ({ count: s.count + 1 }));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    useNewThreadSwitchPending.setState((s) => ({ count: Math.max(0, s.count - 1) }));
  };
}

/** Hook selector: true while any user-initiated New switch is pending. */
export function useIsNewThreadSwitchPending(): boolean {
  return useNewThreadSwitchPending((s) => s.count > 0);
}

/** Non-hook read, for plain functions outside React render. */
export function isNewThreadSwitchPending(): boolean {
  return useNewThreadSwitchPending.getState().count > 0;
}

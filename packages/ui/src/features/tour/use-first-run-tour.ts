/**
 * First-run gate for the TutorialOverlay.
 *
 * The tour auto-opens ONLY on an empty workspace (a brand-new install) — never
 * for a returning user who already has sessions. The remote session list loads
 * asynchronously, so an empty list on the first frame is not yet proof of a
 * fresh install; we wait a short settle window and arm only if no REAL session
 * (drafts excluded) has appeared by then. Once armed — or already mid-tour from
 * a persisted step — the gate latches, so creating the first session *during*
 * the tour does not dismiss it.
 */
import { useEffect, useRef, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { threadListStateToSessionItems } from '../sessions/view-model/chat-to-thread-custom';
import { useTutorialStore } from '@/store/tutorial';

/** Time to let the remote chats list load before deciding the workspace is empty. */
const SETTLE_MS = 1500;

export function useFirstRunTour(): boolean {
  const completed = useTutorialStore((s) => s.completed);
  const step = useTutorialStore((s) => s.step);
  const runtime = useAssistantRuntime();
  // A persisted step > 0 means the tour was already running (e.g. a reload
  // mid-tour) — keep showing it without re-checking the workspace.
  const [armed, setArmed] = useState(step > 0);
  const armedRef = useRef(armed);
  armedRef.current = armed;

  useEffect(() => {
    if (completed || armedRef.current) return;
    const sessionCount = () => threadListStateToSessionItems(runtime.threads.getState()).length;
    // Returning user with sessions already loaded — never auto-open.
    if (sessionCount() > 0) return;

    const timer = setTimeout(() => {
      if (sessionCount() === 0) setArmed(true);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [completed, runtime]);

  return !completed && armed;
}

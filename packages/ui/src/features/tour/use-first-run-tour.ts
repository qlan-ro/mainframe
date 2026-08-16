/**
 * First-run gate for the TutorialOverlay.
 *
 * The tour opens on a workspace that has a project but no sessions yet — never
 * for a returning user who already has sessions, and never on a truly bare
 * install. Both halves of that are deliberate:
 *
 *  - No sessions, because this is a first-run tour. The remote list loads
 *    asynchronously, so an empty list on the first frame isn't proof of a fresh
 *    install; we wait a settle window and arm only if no REAL session (drafts
 *    excluded) has appeared.
 *  - At least one project, because with none the app renders its first-run hero
 *    instead of a chat surface, and the session rail the tour points at doesn't
 *    mount at all. That screen already carries its own "Add project" call to
 *    action, so nothing is lost by waiting: adding the first project puts the
 *    workspace into the state the tour describes, and the tour follows.
 *
 * Once armed — or already mid-tour from a persisted step — the gate latches, so
 * creating the first session *during* the tour does not dismiss it.
 */
import { useEffect, useRef, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { regularThreadItemsToSessionItems } from '../sessions/view-model/chat-to-thread-custom';
import { useProjects } from '../sessions/use-projects';
import { useTutorialStore } from '@/store/tutorial';

/** Time to let the remote chats list load before deciding the workspace is empty. */
const SETTLE_MS = 1500;

export function useFirstRunTour(): boolean {
  const completed = useTutorialStore((s) => s.completed);
  const step = useTutorialStore((s) => s.step);
  const aui = useAui();
  const { projects } = useProjects();
  const hasProject = projects.length > 0;
  // A persisted step > 0 means the tour was already running (e.g. a reload
  // mid-tour) — keep showing it without re-checking the workspace.
  const [armed, setArmed] = useState(step > 0);
  const armedRef = useRef(armed);
  armedRef.current = armed;

  useEffect(() => {
    if (completed || armedRef.current || !hasProject) return;
    // Regular-only: counting archived sessions would suppress the tour for someone
    // whose every session is archived — an empty workspace as far as the tour cares.
    const sessionCount = () => regularThreadItemsToSessionItems(aui.threads.getState().threadItems).length;
    // Returning user with sessions already loaded — never auto-open.
    if (sessionCount() > 0) return;

    const timer = setTimeout(() => {
      if (sessionCount() === 0) setArmed(true);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [completed, hasProject, aui]);

  return !completed && armed;
}

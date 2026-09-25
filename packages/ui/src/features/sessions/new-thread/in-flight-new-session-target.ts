/**
 * in-flight-new-session-target — reads the project a New-session trigger is
 * ALREADY resolving for the active draft, so a second trigger arriving before
 * the first one has seeded draft config can see it too (todo #365).
 *
 * Only meaningful when the active thread IS the new-thread slot (a trigger on
 * some other thread starts a brand-new sequence). Two sources, checked in
 * order:
 *  1. The pending-draft-project stash — set for the whole openNewThreadDraft
 *     sequence (reset → switch → initializeDraft), so it covers the gap
 *     before initializeDraft has even begun.
 *  2. The draft's own initialization record, once `initializeDraft` has
 *     called `beginInitialization` and stashed the target there.
 *
 * `blocking` is true only when the target is still being actively resolved —
 * the stash (always, while set) or an initialization record with status
 * `'initializing'`. A `'ready'` or `'error'` record is not blocking: a repeat
 * trigger on those runs the full sequence again, as it does today.
 */
import { getPendingDraftProject } from './pending-draft-project';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';

export interface InFlightNewSessionTarget {
  target: string | null;
  blocking: boolean;
}

const NONE: InFlightNewSessionTarget = { target: null, blocking: false };

export function readInFlightNewSessionTarget(
  newThreadId: string | null,
  isActiveSlot: boolean,
): InFlightNewSessionTarget {
  if (!isActiveSlot || newThreadId == null) return NONE;

  const pendingTarget = getPendingDraftProject();
  if (pendingTarget != null) return { target: pendingTarget, blocking: true };

  const initialization = useNewThreadReady.getState().getInitialization(newThreadId);
  if (initialization.projectId == null) return NONE;
  return { target: initialization.projectId, blocking: initialization.status === 'initializing' };
}

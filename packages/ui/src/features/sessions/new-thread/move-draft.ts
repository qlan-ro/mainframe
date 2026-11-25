/**
 * The user moved a draft to another project or worktree (C14): its prose,
 * quotes and attached files stay, what belongs to the old place goes, and a
 * toast says what went and offers to switch back.
 *
 * Called by the pickers only. Creating the session, adopting its worktree and a
 * setup that loads late are not moves.
 */
import {
  boundSummary,
  putBound,
  takeBound,
  type BoundContent,
} from '@/features/chat/composer/draft-content/bound-content';
import { mfToast } from '@/lib/toast';
import { chatControllerRegistry } from '../runtime/chat-controller-registry';
import { getDraftConfig, patchDraftConfig, setDraftConfig, type DraftCfg } from '../runtime/draft-config';
import { isCreatePending } from '../runtime/new-thread-coordinator';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { draftGeneration } from './draft-generation';
import { placeName, samePlace, type DraftPlace } from './draft-place';
import { rescopeNewThreadDraft } from './reset-new-thread-draft';

/** Long enough to read and reach. */
const UNDO_MS = 12_000;

export function moveDraft(threadId: string, from: DraftCfg | undefined, to: DraftPlace, apply: () => void): void {
  const left = from && !samePlace(from, to) ? { bound: takeBound(threadId), from } : undefined;
  apply();
  if (left) sayRemoved(threadId, left.bound, left.from);
}

/** Says what stayed behind in `from`, and offers to go back there with it. */
export function sayRemoved(threadId: string, bound: BoundContent, from: DraftCfg): void {
  const generation = draftGeneration(threadId);
  announceRemoved(bound, placeName(from), () => {
    const gone = draftGeneration(threadId) !== generation;
    if (gone || isCreatePending(threadId) || chatControllerRegistry.get(threadId)?.hasRemoteId()) {
      mfToast.info('Nothing to undo', { description: 'That draft was sent or closed.' });
      return;
    }
    moveDraft(threadId, getDraftConfig(threadId), from, () => applySetup(threadId, from));
    putBound(threadId, bound);
  });
}

export function announceRemoved(bound: BoundContent, place: string | undefined, undo: () => void): void {
  const summary = boundSummary(bound);
  if (summary === '') return;
  mfToast.info(`Removed ${summary}${place ? ` from ${place}` : ''}`, {
    duration: UNDO_MS,
    action: { label: 'Undo', onClick: undo },
  });
}

/** Puts a draft back where it was; in the same project, everything else chosen since stays. */
export function applySetup(threadId: string, setup: DraftCfg): void {
  if (getDraftConfig(threadId)?.projectId === setup.projectId) {
    const { worktreePath, branchName, pendingWorktree, temporary } = setup;
    patchDraftConfig(threadId, { worktreePath, branchName, pendingWorktree, temporary });
    return;
  }
  rescopeNewThreadDraft(threadId);
  setDraftConfig(threadId, setup);
  // Also ends an initialization still on its way for the other project.
  useNewThreadReady.getState().beginReadyReplacement(threadId);
}

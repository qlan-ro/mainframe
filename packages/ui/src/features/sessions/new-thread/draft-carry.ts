/**
 * A daemon switch remounts everything that belongs to the old daemon, the open
 * draft included. Its prose, quotes and attached files go along to the new
 * daemon's draft; what belongs to the old place stays behind (`move-draft.ts`).
 */
import { useEffect } from 'react';
import { useAui, useAuiState, type Attachment } from '@assistant-ui/react';
import { putBound, takeBound, type BoundContent } from '@/features/chat/composer/draft-content/bound-content';
import { readLiveComposerState } from '@/features/chat/composer/read-live-composer-state';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { restoreDraft } from '@/features/chat/composer/unsent/restore-draft';
import {
  closeUnsentDrafts,
  reopenUnsentDrafts,
  type SubmittedDraft,
} from '@/features/chat/composer/unsent/unsent-store';
import { getDraftConfig, setDraftConfig, type DraftCfg } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { isDraftSessionId } from '@/store/layout-persist';
import { mfToast } from '@/lib/toast';
import { endDraftGenerations } from './draft-generation';
import { samePlace } from './draft-place';

interface OpenDraft {
  threadId: string;
  text: string;
  attachments: readonly Attachment[];
}

export interface LeftDraft {
  prose: SubmittedDraft;
  bound: BoundContent;
  setup?: DraftCfg;
}

type CarriedDraft = { prose: SubmittedDraft } & Partial<LeftDraft>;

let readOpenDraft: (() => OpenDraft | undefined) | null = null;
let carried: CarriedDraft | null = null;
let carriedInto: string | null = null;

const isEmpty = ({ text, attachments, composition }: SubmittedDraft) =>
  text === '' && attachments.length === 0 && !composition?.committed.length && !composition?.liveQuote;

/** Before a daemon switch: takes the open draft along. Undefined when no draft is open. */
export function leaveDaemonDraft(): LeftDraft | undefined {
  const open = readOpenDraft?.();
  const left = open && {
    prose: {
      text: open.text,
      composition: useComposerSegments.getState().byThread[open.threadId],
      items: [],
      attachments: [...open.attachments],
      references: {},
    },
    bound: takeBound(open.threadId),
    setup: getDraftConfig(open.threadId),
  };
  carried = left && !isEmpty(left.prose) ? { prose: left.prose } : null;
  closeUnsentDrafts();
  endDraftGenerations();
  return left;
}

/** An Undo of the switch: the draft goes back as it was, with what was written in it since. */
export function returnToDaemonDraft(left: LeftDraft): void {
  carried = { ...left, ...carried };
}

/** An Undo once the user is back by themselves: into the draft that is open, unless it is for somewhere else. */
export function putBackDaemonDraft({ bound, setup }: LeftDraft): void {
  const threadId = readOpenDraft?.()?.threadId;
  const here = threadId === undefined ? undefined : getDraftConfig(threadId);
  if (threadId === undefined || (here && setup && !samePlace(here, setup))) {
    mfToast.info('Nothing to undo', { description: 'That draft was sent or closed.' });
    return;
  }
  if (!here && setup) openIn(threadId, setup);
  putBound(threadId, bound);
}

function openIn(threadId: string, setup: DraftCfg): void {
  setDraftConfig(threadId, setup);
  useNewThreadReady.getState().beginReadyReplacement(threadId);
}

/** The boot selection must not leave a draft the user brought along. */
export const isCarriedDraft = (threadId: string | null): boolean => threadId != null && threadId === carriedInto;

export function useDraftCarry(): void {
  const aui = useAui();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);

  useEffect(() => {
    readOpenDraft = () => {
      const { mainThreadId: threadId, newThreadId } = aui.threads.getState();
      if (!threadId || threadId !== newThreadId) return undefined;
      const { text, attachments } = readLiveComposerState(aui.composer);
      return { threadId, text, attachments };
    };
    return () => {
      readOpenDraft = null;
    };
  }, [aui]);

  useEffect(() => {
    if (!mainThreadId || !isDraftSessionId(mainThreadId)) return;
    reopenUnsentDrafts(mainThreadId);
    if (!carried) return;
    const { prose, bound, setup } = carried;
    carried = null;
    carriedInto = mainThreadId;
    if (setup) openIn(mainThreadId, setup);
    restoreDraft(mainThreadId, aui.composer, prose);
    if (bound) putBound(mainThreadId, bound);
  }, [aui, mainThreadId]);
}

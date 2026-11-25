'use client';

import { useLayoutEffect, useRef } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import type { EnterWhileRunning } from '@/store/ui-prefs';
import { withSteer } from '../../controller/steer';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { readLiveComposerState } from '../read-live-composer-state';
import { toCompleteAttachment } from '../attachment-adapter';
import { composeMessage } from '../draft-content/compose-message';
import { partitionDraftItems, type DraftTarget } from '../draft-content/draft-target';
import { useActiveDraftItems, useDraftTarget } from '../draft-content/use-draft-target';
import { draftItemsOf, holdSentCaptures, useDraftContent, type DraftItem } from '../draft-content/draft-content-store';
import { sessionReferencesFor, useSessionReferences } from '../sessions/session-reference-store';
import { useComposerSegments } from './segment-store';
import { holdSubmittedDraft, useSubmittedDraftLocation } from './submitted-draft';
import { serializeComposition } from './serialize-composition';

/** `steer` folds the message into the running turn; anything else sends or queues it (C9). */
export type SubmitComposition = (mode?: EnterWhileRunning) => void;

export function useSubmitComposition(): SubmitComposition {
  const aui = useAui();
  const threadId = useActiveThreadId();

  const target = useDraftTarget();
  const location = useSubmittedDraftLocation(threadId, target.daemonId, aui.composer);
  const priorTarget = useRef<{ threadId: string; target: DraftTarget } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!threadId) return;
    const origin = priorTarget.current?.threadId === threadId ? priorTarget.current.target : target;
    useDraftContent.getState().bindLegacy(threadId, origin, sessionReferencesFor(threadId));
    priorTarget.current = { threadId, target };
  }, [threadId, target]);

  return (mode) => {
    if (threadId == null) return;
    const composer = aui.composer;
    const state = readLiveComposerState(composer);
    const composition = useComposerSegments.getState().byThread[threadId];

    const text = serializeComposition(composition?.committed ?? [], {
      quote: composition?.liveQuote?.text ?? null,
      text: state.text,
    });
    const items = draftItemsOf(threadId);
    const { active, setAside } = partitionDraftItems(items, target);
    if (text === '' && state.attachments.length === 0 && !active.some((item) => item.kind !== 'mention')) return;

    const savedReferences = sessionReferencesFor(threadId);
    const content = composeMessage(text, items, target, savedReferences);
    const attachments = [...content.attachments, ...state.attachments.map(toCompleteAttachment)];
    const runConfig = mode === 'steer' ? withSteer(state.runConfig) : state.runConfig;
    const submitted = holdSubmittedDraft(location, {
      text: state.text,
      attachments: [...state.attachments],
      items: [...items],
      composition,
      references: Object.fromEntries(savedReferences),
    });
    if (!submitted) holdSentCaptures(threadId, content.captures);
    aui.thread.append({
      role: 'user',
      content: [{ type: 'text', text: content.body }],
      attachments,
      runConfig,
      ...(submitted ? { metadata: { custom: { mainframeSubmittedDraft: submitted } } } : {}),
    });
    composer.reset();
    clearSentContext(threadId, setAside);
  };
}

function clearSentContext(threadId: string, setAside: readonly DraftItem[]): void {
  useComposerSegments.getState().clear(threadId);
  const retained = setAside.filter((item) => item.kind !== 'mention' || !item.removed);
  useDraftContent.setState((s) => ({ byThread: { ...s.byThread, [threadId]: retained } }));
  useSessionReferences.getState().clear(threadId);
  for (const item of retained) {
    if (item.kind === 'mention' && item.referenceLabel) {
      useSessionReferences.getState().record(threadId, item.referenceLabel, item.path);
    }
  }
}

/** Whether submit() would send anything. worktree-missing is not folded in here — Composer.tsx combines it. */
export function useCanSubmit(): boolean {
  const threadId = useActiveThreadId();
  const composition = useComposerSegments((s) => (threadId ? s.byThread[threadId] : undefined));
  const liveText = useAuiState((s) => s.composer?.text ?? '');
  const hasDraftItems = useActiveDraftItems(threadId).some((item) => item.kind !== 'mention');
  const liveAttachmentCount = useAuiState((s) => s.composer?.attachments?.length ?? 0);

  const serialized = serializeComposition(composition?.committed ?? [], {
    quote: composition?.liveQuote?.text ?? null,
    text: liveText,
  });
  return serialized !== '' || liveAttachmentCount > 0 || hasDraftItems;
}

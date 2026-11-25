'use client';

/**
 * The two instruction-chip actions. Neither ever sends.
 *
 * "Run in a new session" mirrors the sidebar's New session row's picker branch, but
 * seeds the draft from the *source* chat instead of a project filter: the New
 * button inherits nothing, and an uninitialized draft renders
 * "Initializing session…" with no composer to fill.
 */
import { useCallback } from 'react';
import { useOpenNewThreadDraft } from '@/features/sessions/new-thread/use-open-new-thread-draft';
import { focusComposerOf } from '../composer/focus-composer';
import { useThreadComposer } from '../composer/thread-composer';
import { useChatExtras } from '../runtime/chat-extras';

export interface InstructionActions {
  /** Appends the instruction to the composer of the chat `from` is in and focuses it. */
  append: (insertText: string, from?: Element) => void;
  /** Opens an initialized draft session in the source chat's project + adapter. */
  runInNewSession: (insertText: string) => void;
}

export function useInstructionActions(): InstructionActions {
  const threadComposer = useThreadComposer();
  const extras = useChatExtras();
  const openNewThreadDraft = useOpenNewThreadDraft();

  const projectId = extras?.state.chatConfig?.projectId ?? null;
  const adapterId = extras?.state.chatConfig?.adapterId;

  const append = useCallback(
    (insertText: string, from?: Element) => {
      const composer = threadComposer();
      const existing = composer.getState().text;
      composer.setText(existing ? `${existing.trimEnd()}\n${insertText}` : insertText);
      focusComposerOf(from);
    },
    [threadComposer],
  );

  const runInNewSession = useCallback(
    (insertText: string) => {
      if (!projectId) {
        console.warn('[smart-actions] source chat has no project; cannot start a session');
        return;
      }
      void openNewThreadDraft({ projectId, adapterId, prefill: insertText });
    },
    [projectId, adapterId, openNewThreadDraft],
  );

  return { append, runInNewSession };
}

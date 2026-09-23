'use client';

/**
 * The two instruction-chip actions. Neither ever sends.
 *
 * "Run in a new session" mirrors `SessionsNewButton`'s picker branch, but
 * seeds the draft from the *source* chat instead of a project filter: the New
 * button inherits nothing, and an uninitialized draft renders
 * "Initializing session…" with no composer to fill.
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { useOpenNewThreadDraft } from '@/features/sessions/new-thread/use-open-new-thread-draft';
import { useChatExtras } from '../runtime/chat-extras';

export interface InstructionActions {
  /** Appends the instruction to the current composer and focuses it. */
  append: (insertText: string) => void;
  /** Opens an initialized draft session in the source chat's project + adapter. */
  runInNewSession: (insertText: string) => void;
}

/** The composer runtime exposes no focus method, so the textarea's own marker attribute is the seam. */
function focusComposerInput(): void {
  document.querySelector<HTMLTextAreaElement>('[data-mf-composer-input]')?.focus();
}

export function useInstructionActions(): InstructionActions {
  // Chips render inside a message, where `MessageByIndexProvider` rebinds the
  // aui context's `composer` to that message's edit composer — an inert no-op
  // until the message is being edited, and a lookup that throws outright once
  // the thread switch leaves the index unresolvable. `threads` is a root scope
  // no provider shadows, so `threads.thread('main').composer()` reaches the
  // live composer regardless of that rebinding.
  const aui = useAui();
  const extras = useChatExtras();
  const openNewThreadDraft = useOpenNewThreadDraft();

  const projectId = extras?.state.chatConfig?.projectId ?? null;
  const adapterId = extras?.state.chatConfig?.adapterId;

  const append = useCallback(
    (insertText: string) => {
      const composer = aui.threads.thread('main').composer();
      const existing = composer.getState().text;
      composer.setText(existing ? `${existing.trimEnd()}\n${insertText}` : insertText);
      focusComposerInput();
    },
    [aui],
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

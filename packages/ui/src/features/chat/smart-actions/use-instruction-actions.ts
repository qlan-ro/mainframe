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
import { useAssistantRuntime } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import { useAdapters } from '@/store/adapters';
import { useSettingsStore } from '@/store/settings';
import { initializeDraft } from '@/features/sessions/new-thread/initialize-draft';
import { resetNewThreadDraft } from '@/features/sessions/new-thread/reset-new-thread-draft';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';

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
  // the thread switch leaves the index unresolvable. `runtime.thread` tracks
  // the main thread by selector, so its composer is always the live one.
  const runtime = useAssistantRuntime();
  const extras = useChatExtras();
  const port = useDaemonPort();
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();

  const projectId = extras?.state.chatConfig?.projectId ?? null;
  const adapterId = extras?.state.chatConfig?.adapterId;

  const append = useCallback(
    (insertText: string) => {
      const composer = runtime.thread.composer;
      const existing = composer.getState().text;
      composer.setText(existing ? `${existing.trimEnd()}\n${insertText}` : insertText);
      focusComposerInput();
    },
    [runtime],
  );

  const runInNewSession = useCallback(
    (insertText: string) => {
      if (!projectId) {
        console.warn('[smart-actions] source chat has no project; cannot start a session');
        return;
      }
      void (async () => {
        try {
          // Clear the reused draft slot before switching, so the new draft never
          // inherits an abandoned one's project.
          resetNewThreadDraft(runtime.threads.getState().newThreadId);
          // `switchToNewThread` owns the slot — `newThreadId` is only readable
          // once it resolves, and prefilling earlier would fill the previously
          // active thread's composer (#212).
          await runtime.threads.switchToNewThread();
          const localId = runtime.threads.getState().newThreadId;
          if (localId == null) throw new Error('No draft session was created');
          await initializeDraft({ localId, projectId, port, defaultAdapterId, adapters, adapterId });
          runtime.thread.composer.setText(insertText);
        } catch (error) {
          mfToast.error('Couldn’t start a new session', {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [runtime, projectId, adapterId, port, defaultAdapterId, adapters],
  );

  return { append, runInNewSession };
}

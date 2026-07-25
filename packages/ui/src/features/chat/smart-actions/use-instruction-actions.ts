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
import { useAssistantRuntime, useAui } from '@assistant-ui/react';
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
  const aui = useAui();
  const runtime = useAssistantRuntime();
  const extras = useChatExtras();
  const port = useDaemonPort();
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();

  const projectId = extras?.state.chatConfig?.projectId ?? null;
  const adapterId = extras?.state.chatConfig?.adapterId;

  const append = useCallback(
    (insertText: string) => {
      const composer = aui.composer();
      // `composer.getState()` is tap-memoized and only refreshes on the next
      // render, so a same-tick read returns pre-edit text and the append would
      // clobber whatever the user just typed (the ComposerTriggers pattern).
      const live = composer.__internal_getRuntime?.();
      const existing = live ? live.getState().text : composer.getState().text;
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
          aui.composer().setText(insertText);
        } catch (error) {
          mfToast.error('Couldn’t start a new session', {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [aui, runtime, projectId, adapterId, port, defaultAdapterId, adapters],
  );

  return { append, runInNewSession };
}

'use client';

/**
 * Per-chat runtime hook — mirrors react-opencode's `useOpenCodeThreadRuntime`.
 *
 * Wires an AcpChatController to assistant-ui's `useExternalStoreRuntime`.
 * The controller is created once per thread id (global registry) and kept warm
 * across switches via `subscribeState`; `opts.active` gates `subscribeLive` (the
 * live WS sub). `onNew` creates the daemon chat for a `__LOCALID_*` thread
 * (createForLocal → setRemoteId) before the first send.
 *
 * The `extras` contract and its consumer hooks (`useChatExtras`,
 * `useChatPermissionFront`, …) live in `chat-extras.ts`.
 */
import { useExternalStoreRuntime } from '@assistant-ui/react';
import { createAttachmentAdapter } from '../composer/attachment-adapter';

/** Stateless — the per-chat daemon upload happens in the controller on send.
 *  Exported for the split-view zone mount (ChatZone), which builds an
 *  ExternalThread client with the same adapter. */
export const CHAT_ATTACHMENT_ADAPTER = createAttachmentAdapter();
const ATTACHMENT_ADAPTER = CHAT_ATTACHMENT_ADAPTER;
import type { AppendMessage, AssistantRuntime, ThreadMessage } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AcpChatController } from '../controller/acp-chat-controller';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { projectChatThreadRepository } from '../controller/project-messages';
import { buildChatExtras, isRunningFromState } from './chat-extras';
import { createForLocal } from '../../sessions/runtime/new-thread-coordinator';
import { chatControllerRegistry } from '../../sessions/runtime/chat-controller-registry';

// ---------------------------------------------------------------------------
// Controller state → useSyncExternalStore
// ---------------------------------------------------------------------------

export function useControllerState(controller: AcpChatController): ChatThreadState {
  // The subscribe/getSnapshot callbacks MUST be stable. An inline arrow gets a
  // fresh identity every render, which makes useSyncExternalStore re-subscribe
  // on every render. `subscribeState` only registers a state-change listener
  // (it never opens a WS sub), so this stays cheap; the live WS sub is gated
  // separately via `subscribeLive` in the active effect. Keep them stable.
  const subscribe = useCallback((listener: () => void) => controller.subscribeState(listener), [controller]);
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Failed send → attachments back to the composer
// ---------------------------------------------------------------------------

async function restoreAttachments(
  runtime: AssistantRuntime | null,
  attachments: AppendMessage['attachments'],
): Promise<boolean> {
  const composer = runtime?.thread.composer;
  const pending = attachments ?? [];
  if (!composer || pending.length === 0) return false;

  let restored = 0;
  for (const attachment of pending) {
    const file = attachment.file;
    if (!file) continue;
    try {
      await composer.addAttachment(file);
      restored += 1;
    } catch (error) {
      console.warn('[chat-runtime] could not restore an attachment to the composer', error);
    }
  }
  return restored === pending.length;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useChatThreadRuntime(
  controller: AcpChatController,
  port: number,
  opts?: { active?: boolean },
): AssistantRuntime {
  const state = useControllerState(controller); // uses controller.subscribeState (always)

  // Seed from REST once on mount (deduped by loadPromise inside controller).
  // A __LOCALID_* thread is a no-op here — controller.load() early-returns until
  // setRemoteId adopts a real daemon id (which re-fires the load itself).
  useEffect(() => {
    void controller.load();
  }, [controller]);

  // Dormancy (D4): open the live WS sub only while this is the active thread.
  // The effect cleanup is the live teardown, so deactivation drops the sub.
  const active = opts?.active ?? false;
  useEffect(() => {
    if (!active) return;
    const stop = controller.subscribeLive();
    return stop;
  }, [controller, active]);

  const isRunning = isRunningFromState(state);

  const messageRepository = useMemo(() => projectChatThreadRepository(state), [state]);

  const extras = useMemo(() => buildChatExtras(controller, port, state), [controller, port, state]);

  // The restore below needs the runtime this hook produces, which doesn't exist
  // yet when onNew is created — the ref closes that loop.
  const runtimeRef = useRef<AssistantRuntime | null>(null);

  // onNew: a new (__LOCALID_*) thread has no daemon chat yet — create it, adopt
  // its id (setRemoteId), then send. A thread that already has a remoteId
  // (pre-existing chat, or one created earlier this session) just sends.
  const onNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      // createChat can 401 before a pending bubble exists, after the composer reset.
      try {
        if (!controller.hasRemoteId()) {
          const { remoteId } = await createForLocal(controller.getThreadId(), port);
          chatControllerRegistry.adopt(controller, remoteId);
        }
        await controller.sendMessage(message);
      } catch (error) {
        // Safe against the composer reset: sendMessage cannot reject before its
        // first await (the upload fetch), so this lands after append() has
        // dropped this promise and use-submit-composition has reset the composer.
        if (await restoreAttachments(runtimeRef.current, message.attachments)) {
          controller.markAttachmentsRestoredForFailure(error);
        }
        throw error;
      }
    },
    [controller, port],
  );

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isLoading: state.loadState.type === 'loading',
    isRunning,
    messageRepository,
    extras,
    adapters: { attachments: ATTACHMENT_ADAPTER },
    onNew,
    onCancel: async () => {
      await controller.cancel();
    },
  });
  runtimeRef.current = runtime;

  return runtime;
}

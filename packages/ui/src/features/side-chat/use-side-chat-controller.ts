'use client';

/**
 * The side chat's shared controller (todo #344, UI rule 8). Read by
 * `SideChatHost` (which owns the `load`/`subscribeLive` effect, so the
 * controller stays warm whether the panel is collapsed or expanded), by the
 * parent header's `SideChatToggle`, and by `SideChatPanelHeader` — all three
 * agree on running/waiting state without each owning its own subscription.
 * `chatControllerRegistry.getOrCreate` is idempotent, so every caller gets the
 * SAME instance for a given side-chat id.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { isRunningFromState } from '@/features/chat/runtime/chat-extras';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

export { isRunningFromState };

/** `null` while the parent has no side chat — every hook here is written to
 *  tolerate that without a conditional hook call at the use site. */
export function useSideChatController(sideChatId: string | null | undefined): AcpChatController | null {
  const port = useDaemonPort();
  return useMemo(
    () => (sideChatId != null ? chatControllerRegistry.getOrCreate(sideChatId, port) : null),
    [sideChatId, port],
  );
}

/** A state read that tolerates a `null` controller (no side chat yet), unlike
 *  the main `useControllerState`, which requires one. */
export function useOptionalControllerState(controller: AcpChatController | null): ChatThreadState | null {
  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribeState(listener) : () => undefined),
    [controller],
  );
  const getSnapshot = useCallback(() => controller?.getState() ?? null, [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Any pending permission/question/plan gate — the same "front" data
 *  `ChatGateMount` dispatches from. Drives the toggle's waiting state and the
 *  panel host's auto-expand-on-gate (UI rule 8). */
export function hasPendingGate(state: ChatThreadState): boolean {
  return Object.keys(state.interactions.permissions).length > 0;
}

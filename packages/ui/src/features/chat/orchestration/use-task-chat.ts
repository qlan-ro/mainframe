/**
 * A task chat's live transcript and gate, for its parent's `delegate_task`
 * card — read through the same per-chat controller the child's own thread
 * uses (`chatControllerRegistry`), so opening the child afterwards finds it
 * warm and a gate answered here is the gate the child's thread shows.
 *
 * Mounted only while the card is expanded: the hook holds the controller's
 * facade activation (`holdActive`, the split-zone hold), which attaches the
 * child's session on the shared per-adapter `/acp/{profile}` connection — a
 * `session/resume` on a socket the app already has, not a new one — and
 * releases it on collapse or unmount, which detaches the stream again. The
 * side-band subscription (config, background tasks) is not taken: the card
 * reads only the transcript and the gate.
 */
import { useCallback, useEffect, useMemo } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import type { ChatPermissionEntry, LoadState } from '../controller/chat-thread-state';
import { selectPermissionFront } from '../gates/select-front';
import { useControllerState } from '../runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '../runtime/use-native-thread-messages';
import { latestMessages } from './task-chat-window';

export interface TaskChatView {
  messages: readonly ThreadMessage[];
  hiddenCount: number;
  loadState: LoadState;
  /** The child's queue-front gate, answered into the child's own session. */
  gate: ChatPermissionEntry | undefined;
  reply: (response: ControlResponse, selectedOptionId?: string) => Promise<void>;
  adapterId: string | undefined;
}

export function useTaskChat(chatId: string): TaskChatView {
  const port = useDaemonPort();
  const controller = chatControllerRegistry.getOrCreate(chatId, port);
  // The hold also loads a cold controller (ChatActivation.ensureFacadeActive).
  useEffect(() => controller.holdActive(), [controller]);

  const state = useControllerState(controller);
  const all = useNativeThreadMessages(state);
  const bounded = useMemo(() => latestMessages(all), [all]);
  const permissions = state.interactions.permissions;
  const gate = useMemo(() => selectPermissionFront(permissions), [permissions]);
  const reply = useCallback(
    (response: ControlResponse, selectedOptionId?: string) => controller.replyToPermission(response, selectedOptionId),
    [controller],
  );

  return {
    messages: bounded.shown,
    hiddenCount: bounded.hiddenCount,
    loadState: state.loadState,
    gate,
    reply,
    adapterId: state.chatConfig?.adapterId,
  };
}

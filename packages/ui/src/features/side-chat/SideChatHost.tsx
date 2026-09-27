'use client';

/**
 * SideChatHost — mounted inside the parent's chat column (the single-view
 * `ChatSurface` and each split `ChatZone`), right after `ChatThread` (todo
 * #344). Docks `SideChatPanel` at the bottom while the parent has a side chat
 * and the panel isn't collapsed.
 *
 * Owns the "keep alive regardless of collapse" half of UI rule 8: the
 * controller is loaded and live-subscribed here, independent of the panel's
 * own mount, so `SideChatToggle` (in the parent's header) can read the same
 * shared controller's running/waiting state even while the panel is hidden.
 * A pending gate expands the panel while the parent is on screen (rule 8) —
 * this host is what "the parent is on screen" means.
 *
 * Also marks the controller `active` for as long as this host is mounted
 * (todo #344 QA fix, AC 11): the facade plane's transcript subscription is
 * gated on `setActive`, same as the main chat runtime (D2 dormancy,
 * `chat-activation.ts`) — a side chat that never activates never attaches,
 * so `session/update`s land nowhere and the transcript stays empty even
 * while messages are live-streaming. Switching to a different session
 * unmounts this host (its `parentChatId`/`sideChatId` no longer resolve) and
 * `setActive(false)` detaches without losing the accumulator; switching back
 * remounts and `setActive(true)` reactivates from the last settled item — a
 * cursor resume, not a full replay, so no new CLI process spawns.
 *
 * The parent's own `sideChatId` (read via `useChatExtras`, bound to whichever
 * thread context this host is mounted under — the main thread, or a zone's
 * rebound one) is the sole source of truth: it disappears reactively on the
 * next `chat.updated` once a side chat is discarded from any client, so a
 * cascade or a remote close makes the panel vanish with no error (an edge
 * case in the spec).
 */
import { useEffect } from 'react';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { useSideChatCollapseStore } from './side-chat-collapse-store';
import { hasPendingGate, useOptionalControllerState, useSideChatController } from './use-side-chat-controller';
import { SideChatPanel } from './SideChatPanel';

export function SideChatHost({ parentChatId }: { parentChatId: string | null }) {
  const sideChatId = useChatExtras()?.state.chatConfig?.sideChatId ?? null;
  const collapsed = useSideChatCollapseStore((s) => (parentChatId != null ? s.isCollapsed(parentChatId) : true));
  const expand = useSideChatCollapseStore((s) => s.expand);
  const controller = useSideChatController(sideChatId);
  const state = useOptionalControllerState(controller);
  const gatePending = state != null && hasPendingGate(state);

  useEffect(() => {
    if (!controller) return;
    controller.setActive(true);
    void controller.load();
    const stop = controller.subscribeLive();
    return () => {
      stop();
      controller.setActive(false);
    };
  }, [controller]);

  // A gate raised while the parent is on screen expands the panel (rule 8).
  useEffect(() => {
    if (parentChatId != null && gatePending) expand(parentChatId);
  }, [parentChatId, gatePending, expand]);

  if (parentChatId == null || sideChatId == null || controller == null) return null;
  if (collapsed) return null;

  // Pass the SAME instance this host loads/subscribes below — the panel must
  // not call `getOrCreate` again on its own, or a dispose-then-recreate race
  // (idle offload, a remote discard racing a re-render) would hand it a
  // second, unloaded, non-subscribed controller while this host keeps the
  // stale one (todo #344, single-owner fix).
  return <SideChatPanel parentChatId={parentChatId} sideChatId={sideChatId} controller={controller} />;
}

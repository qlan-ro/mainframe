'use client';

/**
 * SideChatHost — wraps the parent's `ChatThread` in its chat column (the
 * single-view `ChatSurface` and each split `ChatZone`, todo #344). While the
 * parent has a side chat and the panel isn't collapsed, `SideChatPanel` sits
 * beside the thread behind a draggable divider, or docks below it when the
 * column is too narrow for both (see `sideChatPlacement`). The thread keeps
 * its tree position in both layouts, so switching never remounts it. The
 * parent's session panel is NOT inside this host — it docks as a flex sibling
 * outside it, so the beside/below decision is made on the width that remains.
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
import { useEffect, type ReactNode } from 'react';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { SplitDivider } from '@/features/shared/SplitDivider';
import { useMeasuredWidth } from '@/features/shared/use-measured-width';
import { cn } from '@/lib/utils';
import { useUiPrefs } from '@/store/ui-prefs';
import { MIN_PARENT_BESIDE_WIDTH, MIN_SIDE_CHAT_WIDTH, sideChatPlacement } from './side-chat-placement';
import { useSideChatCollapseStore } from './side-chat-collapse-store';
import { hasPendingGate, useOptionalControllerState, useSideChatController } from './use-side-chat-controller';
import { SideChatPanel } from './SideChatPanel';

type SideChatController = ReturnType<typeof useSideChatController>;

function useKeepLive(controller: SideChatController) {
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
}

/** A gate raised while the parent is on screen expands the panel (rule 8). */
function useExpandOnGate(parentChatId: string | null, controller: SideChatController) {
  const expand = useSideChatCollapseStore((s) => s.expand);
  const state = useOptionalControllerState(controller);
  const gatePending = state != null && hasPendingGate(state);
  useEffect(() => {
    if (parentChatId != null && gatePending) expand(parentChatId);
  }, [parentChatId, gatePending, expand]);
}

export function SideChatHost({ parentChatId, children }: { parentChatId: string | null; children: ReactNode }) {
  const sideChatId = useChatExtras()?.state.chatConfig?.sideChatId ?? null;
  const collapsed = useSideChatCollapseStore((s) => (parentChatId != null ? s.isCollapsed(parentChatId) : true));
  const controller = useSideChatController(sideChatId);
  useKeepLive(controller);
  useExpandOnGate(parentChatId, controller);
  const [columnWidth, measureColumn] = useMeasuredWidth();
  const frac = useUiPrefs((s) => s.sideChatFrac);
  const setFrac = useUiPrefs((s) => s.setSideChatFrac);

  const open = parentChatId != null && sideChatId != null && controller != null && !collapsed;
  const placement = sideChatPlacement(columnWidth);
  const beside = open && placement === 'beside';

  return (
    <div
      ref={measureColumn}
      data-side-chat-placement={open ? placement : undefined}
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', beside ? 'flex-row' : 'flex-col')}
    >
      {/* min-h-0 + flex-col so ChatThread's h-full resolves against a definite
          height — otherwise the sticky composer footer collapses/clips. */}
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={beside ? { flexGrow: 1 - frac, minWidth: MIN_PARENT_BESIDE_WIDTH } : undefined}
      >
        {children}
      </div>
      {beside && (
        <SplitDivider
          testId={`side-chat-divider-${parentChatId}`}
          minLeft={MIN_PARENT_BESIDE_WIDTH}
          minRight={MIN_SIDE_CHAT_WIDTH}
          onFrac={(leftFrac) => setFrac(1 - leftFrac)}
        />
      )}
      {/* The SAME instance useKeepLive holds — a second getOrCreate in the
          panel could race a dispose-then-recreate (todo #344, single-owner fix). */}
      {open && (
        <SideChatPanel
          parentChatId={parentChatId}
          sideChatId={sideChatId}
          controller={controller}
          placement={placement}
          frac={frac}
        />
      )}
    </div>
  );
}

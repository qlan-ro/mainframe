/**
 * One zone of the split chat view: a full ChatThread whose `thread` context is
 * rebound to an ExternalThread client built from the chat's controller —
 * mechanism proven by the 2026-08-11 spike
 * (docs/research/2026-08-11-split-chat-view-patterns.md). BOTH zones render
 * through this mount while split, so a focus click changes only context
 * (`switchToThread`), never a mount — no transcript remount, no scroll jump.
 *
 * The zone is a complete chat column: the regular ChatCardHeader (zone mode —
 * close ✕ instead of the whole-surface controls) and its own session panel +
 * rail, both resolving per zone because `useActiveIdentity` and the panel
 * cards read the rebound `threadListItem`/extras contexts.
 *
 * The zone holds its own live-subscription ref; `subscribeLive` is ref-counted
 * on the controller, so the focused zone (also main, whose per-item runtime
 * hook holds a ref of its own) is safe.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { AuiConfig, AuiProvider, ExternalThread, useAui, type AppendMessage } from '@assistant-ui/react';
import { Derived } from '@assistant-ui/store';
import { cn } from '@/lib/utils';
import { SessionPanel } from '@/features/session-panel/SessionPanel';
import { useSessionPanelState } from '@/features/session-panel/use-session-panel-state';
import { chatControllerRegistry } from '../../sessions/runtime/chat-controller-registry';
import { useDaemonPort } from '../../sessions/runtime/daemon-port-context';
import { buildChatExtras, CHAT_ATTACHMENT_ADAPTER, useControllerState } from '../runtime/use-chat-thread-runtime';
import { projectChatThreadMessages } from '../controller/project-messages';
import { ChatCardHeader } from '../thread/ChatCardHeader';
import { ChatThread } from '../thread/ChatThread';

export function ChatZone({
  chatId,
  focused,
  grow = 1,
  onFocus,
  onClose,
}: {
  chatId: string;
  focused: boolean;
  /** Flex share of the split row (divider-dragged); both zones share basis 0. */
  grow?: number;
  onFocus: () => void;
  onClose: () => void;
}) {
  const aui = useAui();
  const port = useDaemonPort();
  const controller = chatControllerRegistry.getOrCreate(chatId, port);
  const state = useControllerState(controller);
  const panelState = useSessionPanelState();

  // Seed once + hold this zone's live ref for as long as it is visible.
  useEffect(() => {
    void controller.load();
    const stop = controller.subscribeLive();
    return stop;
  }, [controller]);

  const messages = useMemo(() => projectChatThreadMessages(state), [state]);
  const isRunning = state.runState.type === 'running' || state.runState.type === 'cancelling';
  const extras = useMemo(() => buildChatExtras(controller, port, state), [controller, port, state]);

  // Zones only ever hold sessions with a daemon chat (the reconciler closes the
  // split on a draft), so send needs no createForLocal branch.
  const onNew = useCallback(
    (message: AppendMessage) => {
      void controller.sendMessage(message);
    },
    [controller],
  );

  // ONE provider carries both scopes: `thread` (the ExternalThread client) and
  // `threadListItem` (the by-id Derived query, SessionRowItemScope's pattern).
  // They cannot be nested providers — an inner `extends={aui}` chains to the
  // ROOT context and would drop the outer rebinding.
  const config = useMemo(
    () =>
      AuiConfig({
        thread: ExternalThread({
          messages,
          isRunning,
          isLoading: state.loadState.type === 'loading',
          extras,
          onNew,
          onCancel: () => {
            void controller.cancel();
          },
          attachmentAdapter: CHAT_ATTACHMENT_ADAPTER,
        }),
        threadListItem: Derived({
          source: 'threads',
          query: { type: 'id', id: chatId },
          get: (client) => client.threads.item({ id: chatId }),
        }),
      }),
    [messages, isRunning, state.loadState.type, extras, onNew, controller, chatId],
  );

  return (
    <AuiProvider extends={aui} config={config}>
      <div
        data-testid={`chat-zone-${chatId}`}
        data-focused={focused}
        // flex-1 gives 1 1 0%; the inline grow overrides just the share so the
        // divider drag resizes without touching shrink/basis.
        style={{ flexGrow: grow }}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity',
          !focused && 'opacity-75',
        )}
        onPointerDownCapture={() => {
          if (!focused) onFocus();
        }}
      >
        <ChatCardHeader zone={{ chatId, onClose }} />
        {/* The row this zone's panel floats over — measured per zone, so each
            side derives its own rail/overlay mode from its own width. */}
        <div ref={panelState.hostRef} className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ChatThread />
          </div>
          <SessionPanel state={panelState} />
        </div>
      </div>
    </AuiProvider>
  );
}

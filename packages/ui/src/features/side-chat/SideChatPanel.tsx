'use client';

/**
 * SideChatPanel — the side chat's own transcript + composer, beside or below
 * its parent's thread (todo #344). Mounted by `SideChatHost` once the parent
 * has a side chat and the panel is not collapsed; the host picks `placement`.
 *
 * Binds a nested `AuiProvider` to the side chat's own controller, mirroring
 * `ChatZone`'s `thread` construction — but, unlike `ChatZone`, deliberately
 * leaves `threadListItem` unbound (see `side-chat-scope.tsx` for why) and
 * provides the side chat's identity through `SideChatScopeProvider` instead
 * (UI rule 5, settled by the binding spike in
 * `__tests__/SideChatPanel.test.tsx`).
 *
 * The controller itself is kept loaded/live-subscribed by `SideChatHost`
 * regardless of collapse (rule 8); this component only reads its state to
 * render. `SideChatHost` owns the single `getOrCreate` call and passes the
 * instance down as a prop — a second `getOrCreate` here would race a
 * dispose-then-recreate (idle offload, a remote discard) and end up with a
 * second, unloaded, non-subscribed controller while the host keeps the stale
 * one (todo #344, single-owner fix).
 */
import { useCallback, useMemo } from 'react';
import { AuiConfig, AuiProvider, ExternalThread, useAui, type AppendMessage } from '@assistant-ui/react';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { CHAT_ATTACHMENT_ADAPTER, useControllerState } from '@/features/chat/runtime/use-chat-thread-runtime';
import { buildChatExtras, isRunningFromState } from '@/features/chat/runtime/chat-extras';
import { useNativeThreadMessages } from '@/features/chat/runtime/use-native-thread-messages';
import { ChatThread } from '@/features/chat/thread/ChatThread';
import { cn } from '@/lib/utils';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { SessionPanel } from '@/features/session-panel/SessionPanel';
import { useSessionPanelState } from '@/features/session-panel/use-session-panel-state';
import { SideChatScopeProvider } from './side-chat-scope';
import { SideChatPanelHeader } from './SideChatPanelHeader';
import { MIN_SIDE_CHAT_WIDTH, type SideChatPlacement } from './side-chat-placement';

/** The side chat's own thread, driven by its controller. No `threadListItem`
 *  override — see side-chat-scope.tsx. */
function useSideChatThreadConfig(controller: AcpChatController) {
  const port = useDaemonPort();
  const state = useControllerState(controller);
  const messages = useNativeThreadMessages(state);
  const isRunning = isRunningFromState(state);
  const extras = useMemo(() => buildChatExtras(controller, port, state), [controller, port, state]);

  const onNew = useCallback(
    (message: AppendMessage) => {
      void controller.sendMessage(message);
    },
    [controller],
  );

  return useMemo(
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
      }),
    [messages, isRunning, state.loadState.type, extras, onNew, controller],
  );
}

export function SideChatPanel({
  parentChatId,
  sideChatId,
  controller,
  placement,
  frac,
}: {
  parentChatId: string;
  sideChatId: string;
  controller: AcpChatController;
  placement: SideChatPlacement;
  /** The panel's share of the row while beside the parent. */
  frac: number;
}) {
  const aui = useAui();
  const config = useSideChatThreadConfig(controller);
  const panelState = useSessionPanelState();

  const scope = useMemo(() => ({ parentChatId, sideChatId }), [parentChatId, sideChatId]);

  return (
    <AuiProvider extends={aui} config={config}>
      <SideChatScopeProvider value={scope}>
        <div
          data-testid={`side-chat-panel-${parentChatId}`}
          data-placement={placement}
          // Beside: the divider draws the separating hairline. Below: a top border.
          className={cn(
            'flex flex-col overflow-hidden bg-background',
            placement === 'beside' ? 'min-h-0 min-w-0 flex-1' : 'h-[40%] min-h-[220px] shrink-0 border-t border-border',
          )}
          style={placement === 'beside' ? { flexGrow: frac, minWidth: MIN_SIDE_CHAT_WIDTH } : undefined}
        >
          <SideChatPanelHeader parentChatId={parentChatId} sideChatId={sideChatId} controller={controller} />
          {/* Its own session rail, floating over its own column — as a split zone's does. */}
          <div ref={panelState.hostRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatThread variant="side" />
            <SessionPanel state={panelState} />
          </div>
        </div>
      </SideChatScopeProvider>
    </AuiProvider>
  );
}

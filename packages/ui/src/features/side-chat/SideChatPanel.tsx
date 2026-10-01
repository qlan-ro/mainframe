'use client';

/**
 * SideChatPanel — the side chat's own transcript + composer, docked at the
 * bottom of its parent's chat column (todo #344). Mounted by `SideChatHost`
 * once the parent has a side chat and the panel is not collapsed.
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
import { projectChatThreadMessages } from '@/features/chat/controller/project-messages';
import { ChatThread } from '@/features/chat/thread/ChatThread';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { SideChatScopeProvider } from './side-chat-scope';
import { SideChatPanelHeader } from './SideChatPanelHeader';

export function SideChatPanel({
  parentChatId,
  sideChatId,
  controller,
}: {
  parentChatId: string;
  sideChatId: string;
  controller: AcpChatController;
}) {
  const aui = useAui();
  const port = useDaemonPort();
  const state = useControllerState(controller);

  const messages = useMemo(() => projectChatThreadMessages(state), [state]);
  const isRunning = isRunningFromState(state);
  const extras = useMemo(() => buildChatExtras(controller, port, state), [controller, port, state]);

  const onNew = useCallback(
    (message: AppendMessage) => {
      void controller.sendMessage(message);
    },
    [controller],
  );

  // No `threadListItem` override — see side-chat-scope.tsx.
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
      }),
    [messages, isRunning, state.loadState.type, extras, onNew, controller],
  );

  const scope = useMemo(() => ({ parentChatId, sideChatId }), [parentChatId, sideChatId]);

  return (
    <AuiProvider extends={aui} config={config}>
      <SideChatScopeProvider value={scope}>
        <div
          data-testid={`side-chat-panel-${parentChatId}`}
          className="flex h-[40%] min-h-[220px] shrink-0 flex-col overflow-hidden border-t border-border bg-background"
        >
          <SideChatPanelHeader parentChatId={parentChatId} sideChatId={sideChatId} controller={controller} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatThread variant="side" />
          </div>
        </div>
      </SideChatScopeProvider>
    </AuiProvider>
  );
}

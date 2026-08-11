/**
 * One zone of the split chat view: a full ChatThread whose `thread` context is
 * rebound to an ExternalThread client built from the chat's controller —
 * mechanism proven by the 2026-08-11 spike
 * (docs/research/2026-08-11-split-chat-view-patterns.md). BOTH zones render
 * through this mount while split, so a focus click changes only context
 * (`switchToThread`), never a mount — no transcript remount, no scroll jump.
 *
 * The zone holds its own live-subscription ref; `subscribeLive` is ref-counted
 * on the controller, so the focused zone (also main, whose per-item runtime
 * hook holds a ref of its own) is safe.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import {
  AuiConfig,
  AuiProvider,
  ExternalThread,
  ThreadListItemRuntimeProvider,
  useAui,
  useAuiState,
  type AppendMessage,
} from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { chatControllerRegistry } from '../../sessions/runtime/chat-controller-registry';
import { useDaemonPort } from '../../sessions/runtime/daemon-port-context';
import { buildChatExtras, CHAT_ATTACHMENT_ADAPTER, useControllerState } from '../runtime/use-chat-thread-runtime';
import { projectChatThreadMessages } from '../controller/project-messages';
import { ChatThread } from '../thread/ChatThread';

function ZoneHeader({ chatId, focused, onClose }: { chatId: string; focused: boolean; onClose: () => void }) {
  const title = useAuiState((s) => s.threads.threadItems.find((t) => t.id === chatId)?.title);
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 border-b border-border px-2.5',
        focused ? 'bg-foreground/4' : 'bg-transparent',
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs font-medium',
          focused ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {title ?? 'Session'}
      </span>
      <button
        type="button"
        data-testid={`chat-zone-close-${chatId}`}
        aria-label="Close zone"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="flex size-4.5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X size={11} aria-hidden />
      </button>
    </div>
  );
}

export function ChatZone({
  chatId,
  focused,
  onFocus,
  onClose,
}: {
  chatId: string;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  const aui = useAui();
  const port = useDaemonPort();
  const controller = chatControllerRegistry.getOrCreate(chatId, port);
  const state = useControllerState(controller);

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

  // The item scope (title/status reads inside the tree) must match the zone's
  // chat, not the focused one. The accessor is optional-but-typed public API.
  const itemRuntime = useMemo(
    () => aui.threads.__internal_getAssistantRuntime?.().threads.getItemById(chatId),
    [aui, chatId],
  );

  const body = (
    <AuiProvider extends={aui} config={config}>
      <div
        data-testid={`chat-zone-${chatId}`}
        data-focused={focused}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity',
          !focused && 'opacity-75',
        )}
        onPointerDownCapture={() => {
          if (!focused) onFocus();
        }}
      >
        <ZoneHeader chatId={chatId} focused={focused} onClose={onClose} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatThread />
        </div>
      </div>
    </AuiProvider>
  );

  if (!itemRuntime) return body;
  return <ThreadListItemRuntimeProvider runtime={itemRuntime}>{body}</ThreadListItemRuntimeProvider>;
}

/**
 * One zone of the split chat view: a full ChatThread whose `thread` context is
 * rebound to an ExternalThread client built from the chat's controller —
 * mechanism proven by the 2026-08-11 spike
 * (docs/research/2026-08-11-split-chat-view-patterns.md). BOTH zones render
 * through this mount while split, so a focus click changes only context
 * (`switchToThread`), never a mount — no transcript remount, no scroll jump.
 *
 * The zone is a complete chat column: a `ChatColumnHeader` (name, fork-parent
 * link, its own session-details toggle, close ✕) and its OWN session panel, resolving
 * per zone because `useActiveIdentity` and the panel sections read the rebound
 * `threadListItem`/extras contexts. Each half opens/closes its panel
 * independently (per-column open state); a half too narrow to dock floats it.
 *
 * The zone holds its own live-subscription ref and an activation hold (both
 * counted on the controller), so the focused zone — also main, whose per-item
 * runtime hook holds its own — is safe, and the unfocused one stays attached.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { AuiConfig, AuiProvider, ExternalThread, useAui, type AppendMessage } from '@assistant-ui/react';
import { Derived } from '@assistant-ui/store';
import { cn } from '@/lib/utils';
import { SessionPanel } from '@/features/session-panel/SessionPanel';
import { useSessionPanelState } from '@/features/session-panel/use-session-panel-state';
import { zoneColumnId } from '@/features/session-panel/panel-control-store';
import { chatControllerRegistry } from '../../sessions/runtime/chat-controller-registry';
import { useDaemonPort } from '../../sessions/runtime/daemon-port-context';
import { CHAT_ATTACHMENT_ADAPTER, useControllerState } from '../runtime/use-chat-thread-runtime';
import { buildChatExtras, isRunningFromState, useChatExtrasState } from '../runtime/chat-extras';
import { useNativeThreadMessages } from '../runtime/use-native-thread-messages';
import { takeStash, waitForStash, type DraftStash } from '../runtime/draft-stash';
import { ChatThread } from '../thread/ChatThread';
import { ChatColumnHeader } from '../thread/ChatColumnHeader';
import { SideChatHost } from '@/features/side-chat/SideChatHost';

/**
 * Restores a `draft-stash` seed (a "Fork from here" prefill, or a #178
 * offload-release draft) into THIS zone's own composer. Mounted inside the
 * zone's rebound `AuiProvider`, so `useAui().thread` resolves to its
 * `ExternalThread` client, not the outer/main one — `useChatRuntimeHook`'s
 * hidden kept-warm instance for this same chatId defers to this effect
 * (`skipDraftRestore`) so the one-shot take lands here, where it is visible.
 *
 * `takeStash` can find nothing on the FIRST check even when a draft is
 * coming: a split that only fits once the workspace panel parks hands its
 * draft off from the instance that was displaying it (review follow-up on
 * 214de9d4) via that instance's OWN re-render — a separate commit from the
 * one that mounts this zone, with no ordering guarantee between the two.
 * `waitForStash` covers the gap: it fires the moment the handoff lands,
 * however late.
 */
function ZoneDraftRestore({ chatId }: { chatId: string }): null {
  const aui = useAui();
  useEffect(() => {
    const apply = (draft: DraftStash): void => {
      const composer = aui.thread.composer();
      composer.setText(draft.text);
      for (const file of draft.attachments) {
        void composer.addAttachment(file).catch((error: unknown) => {
          console.warn('[chat-zone] could not restore a stashed attachment', error);
        });
      }
    };
    const draft = takeStash(chatId);
    if (draft != null) {
      apply(draft);
      return;
    }
    return waitForStash(chatId, () => {
      const handedOff = takeStash(chatId);
      if (handedOff != null) apply(handedOff);
    });
  }, [chatId, aui]);
  return null;
}

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
  const panelState = useSessionPanelState(zoneColumnId(chatId));

  // Seed once + hold this zone's live ref AND its facade-plane activation for
  // as long as it is visible: activation otherwise follows the main thread
  // only, so an unfocused zone never attached its transcript (blank until
  // clicked) and a zone that lost focus stopped streaming.
  useEffect(() => {
    void controller.load();
    const stop = controller.subscribeLive();
    const release = controller.holdActive();
    return () => {
      release();
      stop();
    };
  }, [controller]);

  const messages = useNativeThreadMessages(state);
  const isRunning = isRunningFromState(state);
  const extrasState = useChatExtrasState(state);
  const extras = useMemo(() => buildChatExtras(controller, port, extrasState), [controller, port, extrasState]);

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
      <ZoneDraftRestore chatId={chatId} />
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
        {/* Measured per zone, before the panel takes its width, so each side
            derives its own inline/overlay mode from its own width. The header
            sits INSIDE the transcript column so the panel runs full height. */}
        <div ref={panelState.hostRef} data-chat-column className="relative flex min-h-0 flex-1 overflow-hidden">
          <SideChatHost parentChatId={chatId}>
            <ChatColumnHeader
              columnId={zoneColumnId(chatId)}
              toggleTestId={`session-panel-toggle-${chatId}`}
              zone={{ chatId, onClose }}
            />
            <div className="min-h-0 flex-1">
              <ChatThread />
            </div>
          </SideChatHost>
          <SessionPanel state={panelState} />
        </div>
      </div>
    </AuiProvider>
  );
}

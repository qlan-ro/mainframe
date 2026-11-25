import { useEffect, useMemo, useState, useRef } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useControllerState } from '../runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '../runtime/use-native-thread-messages';
import { AgentSteps } from '../messages/turn/AgentSteps';
import { RootTranscriptScope } from '../messages/turn/transcript-scope';
import { agentLaunched } from '../messages/turn/agent-outcome';
import { resolveResultText } from '../tools/shared';
import type { SubagentZoneRef } from './zones-store';
import { findSubagentCall } from './find-subagent-transcript';
import { pendingToolIds, subagentOutcome } from './subagent-outcome';
import { findToolCall } from '@/features/session-panel/activity-model';

function SubagentZoneHeader({
  title,
  toolCallId,
  onClose,
}: {
  title: string;
  toolCallId: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      <Hint label="Close zone">
        <Button
          data-testid={`chat-subagent-close-${toolCallId}`}
          aria-label="Close subagent transcript"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </Hint>
    </div>
  );
}

const NO_MESSAGES: readonly ThreadMessage[] = [];

export function SubagentZone({
  subagent,
  grow,
  onClose,
}: {
  subagent: SubagentZoneRef;
  grow: number;
  onClose: () => void;
}) {
  const port = useDaemonPort();
  const controller = useChatController(subagent.parentChatId, port);
  const state = useControllerState(controller);
  const messages = useNativeThreadMessages(state);
  const call = findSubagentCall(messages, subagent.toolCallId);
  const transcript = call && (call.messages ?? NO_MESSAGES);
  const messageId = subagent.messageId ?? findToolCall(messages, subagent.toolCallId)?.messageId;
  const partial = controller.isHistoryContext(subagent.toolCallId);
  const pending = useMemo(() => pendingToolIds(state), [state]);
  const outcome = call ? subagentOutcome(call, state) : 'done';
  const result = resolveResultText(call?.result).text;
  const root = useRef<HTMLDivElement>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    void controller.load();
    const stop = controller.subscribeLive();
    const release = controller.holdActive();
    return () => {
      release();
      stop();
    };
  }, [controller]);
  useEffect(() => root.current?.focus(), [subagent]);
  useEffect(() => {
    if (state.loadState?.type !== 'ready' || (transcript && !partial)) return;
    if (!state.historyWindow?.hasMore || (!partial && messages.some((message) => message.id === messageId))) {
      setHistoryError('Not in this transcript');
      return;
    }
    let cancelled = false;
    void controller.loadEarlier(subagent.toolCallId).then(
      (found) => {
        if (!cancelled && !found) setHistoryError('Not in this transcript');
      },
      (error: unknown) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Could not load transcript');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    controller,
    partial,
    messageId,
    state.loadState?.type,
    state.historyWindow?.hasMore,
    transcript,
    messages,
    subagent.toolCallId,
  ]);

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-testid={`chat-subagent-zone-${subagent.toolCallId}`}
      style={{ flexGrow: grow }}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
    >
      <SubagentZoneHeader title={subagent.title} toolCallId={subagent.toolCallId} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {call && transcript ? (
          <RootTranscriptScope>
            <AgentSteps
              messages={transcript}
              messageId={messageId ?? ''}
              toolCallId={subagent.toolCallId}
              chatId={subagent.parentChatId}
              pendingToolIds={pending}
              outcome={outcome}
              result={outcome === 'done' && agentLaunched(result) ? '' : result}
            />
          </RootTranscriptScope>
        ) : (
          <p className="text-sm text-muted-foreground">{historyError ?? 'Loading subagent transcript...'}</p>
        )}
      </div>
      <p className="shrink-0 border-t border-border px-5 py-3 text-center text-xs text-muted-foreground">
        Subagent transcript · read-only
      </p>
    </div>
  );
}

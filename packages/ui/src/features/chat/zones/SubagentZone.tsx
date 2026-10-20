import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useControllerState } from '../runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '../runtime/use-native-thread-messages';
import { SubagentTranscript } from '../tools/cards/SubagentTranscript';
import { RootTranscriptScope } from '../messages/compact/transcript-scope';
import type { SubagentZoneRef } from './zones-store';
import { findSubagentTranscript } from './find-subagent-transcript';

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
  const transcript = findSubagentTranscript(messages, subagent.toolCallId);
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
    if (state.loadState?.type !== 'ready' || transcript) return;
    if (!state.historyWindow?.hasMore || messages.some((message) => message.id === subagent.messageId)) {
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
    subagent.messageId,
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
        {transcript ? (
          <RootTranscriptScope>
            <SubagentTranscript
              messages={transcript}
              messageId={subagent.messageId}
              toolCallId={subagent.toolCallId}
              inZone
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

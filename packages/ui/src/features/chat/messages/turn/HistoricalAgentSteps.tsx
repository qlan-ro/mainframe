import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useKnownDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { AgentSteps, type AgentStepsProps } from './AgentSteps';
import { historyKey, loadSubagentPage, useSubagentHistoryStore } from './subagent-history-store';
import { SubagentTranscriptScope, useTranscriptScope } from './transcript-scope';

export function HistoricalAgentSteps({
  chatId,
  nativeAgentId,
  ...props
}: AgentStepsProps & { chatId: string; nativeAgentId?: string | null }) {
  const port = useKnownDaemonPort();
  const { toolCallId } = props;
  const key = historyKey(chatId, toolCallId);
  const entry = useSubagentHistoryStore((state) => state.entries.get(key));
  // Where this call itself lives: the chat, or the sub-agent whose page holds the row.
  const { subagentId: callSource } = useTranscriptScope();
  const boundary = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (older = false) => {
      if (port === null || nativeAgentId === null) return;
      const controller = chatControllerRegistry.getOrCreate(chatId, port);
      void loadSubagentPage(
        key,
        (before) => controller.subagentHistory.page(nativeAgentId ?? toolCallId, before),
        older,
      );
    },
    [chatId, key, nativeAgentId, port, toolCallId],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const node = boundary.current;
    const viewport = node?.closest<HTMLElement>('[data-conversation-scroller], [data-mf-chat-thread]');
    if (!viewport || !node || !entry?.before || entry.loading || entry.error) return;
    const check = () => {
      const distance = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      if (Math.abs(distance) <= viewport.clientHeight) load(true);
    };
    let scrollTop = viewport.scrollTop;
    const scroll = () => {
      const up = viewport.scrollTop < scrollTop;
      scrollTop = viewport.scrollTop;
      if (up) check();
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) check();
    };
    viewport.addEventListener('wheel', wheel, { passive: true });
    viewport.addEventListener('scroll', scroll, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('scroll', scroll);
    };
  }, [entry, load]);

  return (
    <>
      <div ref={boundary} className="text-xs text-muted-foreground">
        {entry?.loading && <span role="status">Loading sub-agent history…</span>}
        {(!entry || entry.error) && (
          <div role="alert">
            Could not load sub-agent history.
            {nativeAgentId !== null && (
              <Button variant="ghost" size="sm" onClick={() => load(Boolean(entry?.before))}>
                Retry
              </Button>
            )}
          </div>
        )}
        {entry?.before && !entry.loading && !entry.error && (
          <Button variant="ghost" size="sm" onClick={() => load(true)}>
            Earlier messages
          </Button>
        )}
      </div>
      {/* Only rows read from the child's page live in its transcript. The steps an
          older parent kept inline, and the call's own result, live where the call does. */}
      <SubagentTranscriptScope subagentId={entry ? (nativeAgentId ?? toolCallId) : callSource}>
        <AgentSteps
          {...props}
          messages={entry?.messages ?? props.messages}
          resultBody={
            props.resultBody && (
              <SubagentTranscriptScope subagentId={callSource}>{props.resultBody}</SubagentTranscriptScope>
            )
          }
        />
      </SubagentTranscriptScope>
    </>
  );
}

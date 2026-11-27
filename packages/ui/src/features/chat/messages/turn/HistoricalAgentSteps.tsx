import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useKnownDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { AgentSteps, type AgentStepsProps } from './AgentSteps';
import { historyKey, loadSubagentPage, useSubagentHistoryStore, type LoadSide } from './subagent-history-store';
import { SubagentTranscriptScope, useTranscriptScope } from './transcript-scope';
import { useAnnounceSubagentPages, useEdgePaging } from './use-subagent-paging';

/**
 * The loading line is as tall as the button it replaces (`h-8`, the small ghost button), so pressing
 * "Earlier messages" or "Later messages" does not move the steps under the reader: the browser does
 * not anchor a change inside the block it anchors on.
 */
function Loading() {
  return (
    <span role="status" className="flex h-8 items-center">
      Loading sub-agent history…
    </span>
  );
}

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
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (side: LoadSide = 'open') => {
      if (port === null || nativeAgentId === null) return;
      const controller = chatControllerRegistry.getOrCreate(chatId, port);
      const agentId = nativeAgentId ?? toolCallId;
      void loadSubagentPage(
        key,
        (before, until) =>
          until
            ? controller.subagentHistory.page(agentId, before, until)
            : controller.subagentHistory.page(agentId, before),
        side,
      );
    },
    [chatId, key, nativeAgentId, port, toolCallId],
  );
  const loadOlder = useCallback(() => load('older'), [load]);
  const loadNewer = useCallback(() => load('newer'), [load]);

  useEffect(() => {
    load();
  }, [load]);
  const idle = entry !== undefined && !entry.loading && !entry.error;
  useEdgePaging(top, 'older', idle && Boolean(entry?.before), loadOlder);
  useEdgePaging(bottom, 'newer', idle && entry?.later === true, loadNewer);
  useAnnounceSubagentPages(key);
  const loadingNewer = entry?.loading === true && entry.side === 'newer';

  return (
    <>
      <div ref={top} className="text-xs text-muted-foreground">
        {entry?.loading && !loadingNewer && <Loading />}
        {(!entry || entry.error) && (
          <div role="alert">
            Could not load sub-agent history.
            {nativeAgentId !== null && (
              <Button
                data-testid={`chat-agent-history-retry-${toolCallId}`}
                variant="ghost"
                size="sm"
                onClick={() => load(entry?.side ?? 'open')}
              >
                Retry
              </Button>
            )}
          </div>
        )}
        {idle && entry?.before && (
          <Button data-testid={`chat-agent-earlier-${toolCallId}`} variant="ghost" size="sm" onClick={loadOlder}>
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
          endsEarly={entry?.later === true}
          after={
            <>
              {/* The newest pages were dropped while the reader paged up: they load again from here. */}
              <div ref={bottom} className="text-xs text-muted-foreground">
                {loadingNewer && <Loading />}
                {idle && entry?.later && (
                  <Button data-testid={`chat-agent-later-${toolCallId}`} variant="ghost" size="sm" onClick={loadNewer}>
                    Later messages
                  </Button>
                )}
              </div>
              {props.after}
            </>
          }
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

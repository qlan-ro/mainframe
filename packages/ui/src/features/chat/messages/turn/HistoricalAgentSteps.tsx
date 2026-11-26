import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useKnownDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { AgentSteps, type AgentStepsProps } from './AgentSteps';
import { historyKey, loadSubagentPage, useSubagentHistoryStore } from './subagent-history-store';

export function HistoricalAgentSteps({ chatId, ...props }: AgentStepsProps & { chatId: string }) {
  const port = useKnownDaemonPort();
  const { toolCallId } = props;
  const key = historyKey(chatId, toolCallId);
  const entry = useSubagentHistoryStore((state) => state.entries.get(key));
  const boundary = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (older = false) => {
      if (port === null) return;
      const controller = chatControllerRegistry.getOrCreate(chatId, port);
      void loadSubagentPage(key, (before) => controller.subagentHistory.page(toolCallId, before), older);
    },
    [chatId, key, port, toolCallId],
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
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) check();
    };
    viewport.addEventListener('wheel', wheel, { passive: true });
    viewport.addEventListener('scroll', check, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('scroll', check);
    };
  }, [entry, load]);

  return (
    <>
      <div ref={boundary} className="text-xs text-muted-foreground">
        {(!entry || entry.loading) && <span role="status">Loading sub-agent history…</span>}
        {entry?.error && (
          <div role="alert">
            Could not load sub-agent history.
            <Button variant="ghost" size="sm" onClick={() => load(Boolean(entry.before))}>
              Retry
            </Button>
          </div>
        )}
        {entry?.before && !entry.loading && !entry.error && (
          <Button variant="ghost" size="sm" onClick={() => load(true)}>
            Earlier messages
          </Button>
        )}
      </div>
      <AgentSteps {...props} messages={entry?.messages ?? props.messages} />
    </>
  );
}

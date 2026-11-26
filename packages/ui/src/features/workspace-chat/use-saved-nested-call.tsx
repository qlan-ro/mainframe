import { useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import {
  historyKey,
  loadSubagentPage,
  useSubagentHistoryStore,
} from '@/features/chat/messages/turn/subagent-history-store';
import type { SavedNestedLocator } from '@/store/run-pane';
import { findSubagentCall, type SubagentCall } from './find-subagent-call';

export function useSavedNestedCall(
  controller: AcpChatController,
  chatId: string,
  toolCallId: string,
  locator: SavedNestedLocator | undefined,
  loaded: SubagentCall | null,
) {
  const parentId = locator?.parentNativeId;
  const key = parentId ? historyKey(chatId, `containing:${parentId}`) : null;
  const entry = useSubagentHistoryStore((state) => (key ? state.entries.get(key) : undefined));
  const call = useMemo(() => (entry ? findSubagentCall(entry.messages, toolCallId) : null), [entry, toolCallId]);
  const load = useCallback(
    (older = false, refresh = false) => {
      if (key && parentId) {
        void loadSubagentPage(key, (before) => controller.subagentHistory.page(parentId, before), older, refresh);
      }
    },
    [controller, key, parentId],
  );
  useEffect(() => {
    if (!loaded) load();
  }, [load, loaded]);
  useEffect(() => {
    if (!loaded && !call && entry?.before && !entry.loading && !entry.error) load(true);
  }, [loaded, call, entry, load]);
  return {
    call,
    loading: !!entry && !entry.error && (entry.loading || !!entry.before),
    retry: () => {
      if (parentId) load(false, true);
      else void controller.load(true).catch(() => undefined);
    },
  };
}

export function NestedCallUnavailable({ loading, retry }: { loading: boolean; retry: () => void }) {
  if (loading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the sub-agent…
      </p>
    );
  return (
    <div role="alert" className="text-sm text-muted-foreground">
      Sub-agent unavailable.
      <Button variant="ghost" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

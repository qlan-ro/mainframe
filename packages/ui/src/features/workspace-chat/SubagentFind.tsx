import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { HistorySearchResult } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import {
  historyKey,
  loadSubagentPage,
  useSubagentHistoryStore,
} from '@/features/chat/messages/turn/subagent-history-store';

function useResults(controller: AcpChatController, agentId: string, query: string, open: boolean) {
  const [response, setResponse] = useState<{ query: string; result?: HistorySearchResult }>();
  useEffect(() => {
    if (!open || !query.trim()) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void controller.subagentHistory.search(agentId, query).then(
        (result) => {
          if (!cancelled) setResponse({ query, result });
        },
        () => {
          if (!cancelled) setResponse({ query });
        },
      );
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [controller, agentId, query, open]);
  return response?.query === query ? response : undefined;
}

export function SubagentFind({
  controller,
  agentId,
  toolCallId = agentId,
  chatId,
  root,
  active,
}: {
  controller: AcpChatController;
  agentId: string;
  toolCallId?: string;
  chatId: string;
  root: RefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const response = useResults(controller, agentId, query, open);
  const current = response?.result;
  const accepts = useCallback(() => active && !!root.current?.contains(document.activeElement), [active, root]);
  const start = () => {
    setOpen(true);
    input.current?.focus();
  };
  useShortcutAction('chat.find', start, accepts);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const match = current?.matches[index];
  const key = historyKey(chatId, toolCallId);
  const entry = useSubagentHistoryStore((state) => state.entries.get(key));
  useEffect(() => {
    if (!open || !match || !entry || entry.loading || entry.error) return;
    if (entry.before && !entry.messages.some(({ id }) => id === match.containerId)) {
      void loadSubagentPage(
        key,
        (before) => controller.subagentHistory.page(agentId, before, before ? match.itemId : undefined),
        true,
      );
      return;
    }
    const node = root.current?.querySelector<HTMLElement>(
      `[data-search-item-id="${CSS.escape(match.itemId)}"], [data-message-id="${CSS.escape(match.containerId)}"]`,
    );
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    node.classList.add('outline-2', 'outline-primary');
    return () => node.classList.remove('outline-2', 'outline-primary');
  }, [open, match, key, entry, root, controller, agentId]);

  const count = current?.matches.length ?? 0;
  const step = (offset: number) => {
    if (count) setIndex((index + offset + count) % count);
  };
  if (!open)
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Find in sub-agent"
        title="Find in sub-agent"
        data-testid="workspace-agent-find"
        onClick={start}
      >
        <Search />
      </Button>
    );
  return (
    <div className="flex items-center gap-1 text-xs">
      <input
        ref={input}
        type="search"
        aria-label="Find in sub-agent"
        placeholder="Find in sub-agent…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
          if (event.key === 'Escape') setOpen(false);
        }}
        className="w-36 rounded border border-border bg-background px-2 py-1 focus-visible:focus-line-inset"
      />
      {query.trim() && (
        <span role="status" className="whitespace-nowrap text-muted-foreground">
          {current ? `${count ? index + 1 : 0}/${current.total}` : response ? 'Search failed' : 'Searching…'}
        </span>
      )}
      <Button variant="ghost" size="icon-xs" aria-label="Previous match" disabled={!count} onClick={() => step(-1)}>
        <ChevronUp />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Next match" disabled={!count} onClick={() => step(1)}>
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close find" onClick={() => setOpen(false)}>
        <X />
      </Button>
    </div>
  );
}

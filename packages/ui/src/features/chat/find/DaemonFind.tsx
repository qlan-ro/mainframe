import { useEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatExtras } from '../runtime/chat-extras';
import { useFindInChatStore, type FindMatch } from './find-in-chat-store';
import { paintDaemonMatch, messageElement, waitForMessage } from './daemon-highlights';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import type { HistorySearchResult } from '@qlan-ro/mainframe-types';

export function DaemonFind() {
  const extras = useChatExtras();
  const chatId = extras?.state.chatId;
  const enabled = extras?.canSearchHistory === true;
  const messages = useAuiState((s) => s.thread.messages);
  const previous = useRef(messages);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const held = previous.current;
    previous.current = messages;
    const prepend =
      messages.length > held.length &&
      held.every((message, index) => messages[messages.length - held.length + index] === message);
    if (!prepend && messages !== held) setRevision((value) => value + 1);
  }, [messages, enabled]);
  useEffect(() => {
    useFindInChatStore.setState({ daemon: enabled, serverTotal: null, matches: [], activeIndex: 0 });
    return () => {
      useFindInChatStore.setState({ daemon: false, serverTotal: null });
    };
  }, [chatId, enabled]);
  useDaemonSearch(enabled, chatId, revision, extras?.searchHistory);
  useDaemonStep(
    enabled,
    chatId,
    extras?.loadEarlier,
    messages.map((message) => message.id),
  );
  return null;
}

function chooseMatch(matches: FindMatch[], chatId: string | undefined, previous: FindMatch | undefined): number {
  const held =
    previous &&
    matches.findIndex((match) => match.itemId === previous.itemId && match.occurrence === previous.occurrence);
  if (held !== undefined && held >= 0) return held;
  for (let i = matches.length - 1; chatId && i >= 0; i--) {
    const element = messageElement(chatId, matches[i]!.messageId);
    const viewport = element?.closest('[data-mf-chat-thread]');
    if (element && viewport && element.getBoundingClientRect().top <= viewport.getBoundingClientRect().bottom) return i;
  }
  return Math.max(0, matches.length - 1);
}

function useDaemonSearch(
  enabled: boolean,
  chatId: string | undefined,
  revision: number,
  search: ((query: string) => Promise<HistorySearchResult>) | undefined,
) {
  const query = useFindInChatStore((s) => s.query);
  const refresh = useFindInChatStore((s) => s.refresh);
  const open = useFindInChatStore((s) => s.isOpen);
  const sequence = useRef(0);
  const appliedQuery = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  useEffect(() => {
    sequence.current++;
    return () => {
      sequence.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [query, chatId, enabled, open]);
  useEffect(() => {
    if (!enabled || !open || !searchRef.current || timer.current) return;
    timer.current = setTimeout(async () => {
      const ordinal = ++sequence.current;
      timer.current = null;
      useFindInChatStore.setState({ loading: true, error: null });
      try {
        const result = await searchRef.current!(query);
        if (ordinal !== sequence.current) return;
        const current = useFindInChatStore.getState();
        const previous =
          appliedQuery.current === `${chatId}\0${query}` ? current.matches[current.activeIndex] : undefined;
        appliedQuery.current = `${chatId}\0${query}`;
        applySearchResult(result, chatId, previous);
      } catch (error) {
        if (ordinal === sequence.current)
          useFindInChatStore.setState({
            loading: false,
            error: error instanceof Error ? error.message : 'Search failed',
          });
      }
    }, 80);
  }, [enabled, open, query, chatId, revision, refresh]);
}

function useDaemonStep(
  enabled: boolean,
  chatId: string | undefined,
  load: ((target?: string) => Promise<boolean>) | undefined,
  messageIds: string[],
) {
  const { isOpen, query, matches, activeIndex, navigation } = useFindInChatStore();
  const [paint, setPaint] = useState(0);
  const lastNavigation = useRef(navigation);
  const loadRef = useRef(load);
  const heldIds = useRef(messageIds);
  useEffect(() => {
    loadRef.current = load;
    heldIds.current = messageIds;
  }, [load, messageIds]);
  useEffect(() => {
    if (navigation === lastNavigation.current) return;
    lastNavigation.current = navigation;
    const match = matches[activeIndex];
    if (!enabled || !isOpen || !chatId || !match) return;
    let cancelled = false;
    void revealMatch(
      chatId,
      match,
      heldIds.current.includes(match.messageId),
      loadRef.current,
      () => cancelled,
      () => setPaint((value) => value + 1),
    );
    return () => {
      cancelled = true;
    };
  }, [navigation, enabled, chatId, isOpen, query]);
  useEffect(() => {
    if (!enabled || !isOpen || !chatId) return;
    const active = matches[activeIndex];
    const itemHits = Math.max(
      0,
      ...matches.filter((match) => match.itemId === active?.itemId).map((match) => (match.occurrence ?? -1) + 1),
    );
    return paintDaemonMatch(chatId, query, active, itemHits);
  }, [enabled, isOpen, chatId, query, matches, activeIndex, paint]);
}

function applySearchResult(result: HistorySearchResult, chatId: string | undefined, previous: FindMatch | undefined) {
  const matches = result.matches.map((match) => ({
    messageId: match.containerId,
    itemId: match.itemId,
    occurrence: match.occurrence,
    partIndex: 0,
    charStart: -1,
    charEnd: -1,
  }));
  useFindInChatStore.setState({
    matches,
    activeIndex: chooseMatch(matches, chatId, previous),
    serverTotal: result.total,
    truncated: result.truncated === true,
    loading: false,
  });
}

async function revealMatch(
  chatId: string,
  match: FindMatch,
  loaded: boolean,
  load: ((target?: string) => Promise<boolean>) | undefined,
  isCancelled: () => boolean,
  paint: () => void,
) {
  useFindInChatStore.setState({ loading: true, error: null });
  try {
    if (!loaded && !messageElement(chatId, match.messageId) && !(await load?.(match.itemId))) {
      useFindInChatStore.setState((state) => ({ refresh: state.refresh + 1 }));
      return;
    }
    if (isCancelled()) return;
    window.dispatchEvent(
      new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId, source: { messageId: match.messageId } } }),
    );
    const message = await waitForMessage(chatId, match.messageId);
    if (!message || isCancelled()) return;
    window.dispatchEvent(
      new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId, source: { messageId: match.messageId } } }),
    );
    message.querySelector<HTMLButtonElement>('button[aria-label="Read more"]')?.click();
    requestAnimationFrame(() => {
      if (!isCancelled()) {
        message.scrollIntoView({ block: 'center' });
        paint();
      }
    });
  } catch (error) {
    if (!isCancelled())
      useFindInChatStore.setState({ error: error instanceof Error ? error.message : 'Could not show match' });
  } finally {
    if (!isCancelled()) useFindInChatStore.setState({ loading: false });
  }
}

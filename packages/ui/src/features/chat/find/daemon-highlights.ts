import type { FindMatch } from './find-in-chat-store';
import { rangeFromOffsets } from './search-messages';

export function messageElement(chatId: string, messageId: string): HTMLElement | undefined {
  const viewport = [...document.querySelectorAll<HTMLElement>('[data-mf-chat-thread]')].find(
    (el) => el.dataset.mfChatId === chatId,
  );
  return [...(viewport?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find(
    (el) => el.dataset.messageId === messageId,
  );
}

export function waitForMessage(chatId: string, messageId: string): Promise<HTMLElement | undefined> {
  const existing = messageElement(chatId, messageId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = (element?: HTMLElement) => {
      observer.disconnect();
      clearTimeout(timeout);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = messageElement(chatId, messageId);
      if (element) finish(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(() => finish(), 10_000);
  });
}

export function paintDaemonMatch(
  chatId: string,
  query: string,
  match: FindMatch | undefined,
  itemHits: number,
): () => void {
  const message = match && messageElement(chatId, match.messageId);
  if (!message || !match?.itemId || match.occurrence === undefined) return () => undefined;
  const parts = [...message.querySelectorAll<HTMLElement>('[data-text-part]')].filter(
    (part) => part.closest<HTMLElement>('[data-search-item-id]')?.dataset.searchItemId === match.itemId,
  );
  const ranges: Range[] = [];
  for (const part of parts) {
    const text = (part.textContent ?? '').toLowerCase();
    const needle = query.toLowerCase();
    for (let start = text.indexOf(needle); needle && start >= 0; start = text.indexOf(needle, start + 1)) {
      const range = rangeFromOffsets(part, start, start + needle.length);
      if (range) ranges.push(range);
    }
  }
  const active = ranges.length === itemHits ? ranges[match.occurrence] : undefined;
  const outline = message.style.outline;
  if (active && typeof CSS !== 'undefined' && 'highlights' in CSS)
    CSS.highlights.set('mf-find-active', new Highlight(active));
  else message.style.outline = '2px solid var(--primary)';
  return () => {
    message.style.outline = outline;
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete('mf-find-active');
  };
}

/**
 * ChatForkBanner — the single view's "Forked from <title>" row, at the top of
 * the chat column. It renders only on a fork (the link resolves to nothing
 * otherwise), so a regular chat still starts straight at the transcript. In a
 * visible split each zone's `ZoneStrip` carries the same link instead.
 */
import { ChatHeaderParentLink } from './ChatHeaderParentLink';
import { useChatHeaderParentLink } from './use-chat-header-parent-link';

export function ChatForkBanner() {
  const link = useChatHeaderParentLink();
  if (link == null) return null;
  return (
    <div data-testid="chat-fork-banner" className="flex h-8 shrink-0 items-center px-4">
      <ChatHeaderParentLink />
    </div>
  );
}

/**
 * ChatColumnHeader — the chat column's title row: the chat's name, its "Forked
 * from" / "Delegated by" link (on a child), then on the trailing edge its
 * side-chat and session-details toggles. Ongoing work is not repeated here (S4):
 * it shows in the composer and in the panel's Activity section.
 *
 * It sits INSIDE the transcript column (above the thread), so the docked
 * session panel beside it runs the chat area's full height.
 */
import { useAuiState } from '@assistant-ui/react';
import { SessionPanelToggle } from '@/features/session-panel/SessionPanelToggle';
import { SideChatToggle } from '@/features/side-chat/SideChatToggle';
import { ChatHeaderParentLink } from './ChatHeaderParentLink';

function useColumnTitle(): string {
  const title = useAuiState((s) => s.threadListItem?.title);
  const isDraft = useAuiState((s) => s.threadListItem?.id?.startsWith('__LOCALID_') ?? false);
  if (isDraft && !title) return 'New Session';
  return title || 'Untitled';
}

export function ChatColumnHeader() {
  const title = useColumnTitle();
  return (
    <div data-testid="chat-header" className="flex h-11 shrink-0 items-center gap-3 pr-3 pl-4">
      <span data-testid="chat-header-title" className="min-w-0 flex-initial truncate text-title font-semibold">
        {title}
      </span>
      <ChatHeaderParentLink />
      <span className="flex-1" />
      <SideChatToggle />
      {/* The tour's `session-rail` anchor rides this toggle. */}
      <SessionPanelToggle columnId="main" testId="session-panel-toggle" tourAnchor />
    </div>
  );
}

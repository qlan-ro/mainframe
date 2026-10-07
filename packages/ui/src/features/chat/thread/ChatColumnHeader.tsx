/**
 * ChatColumnHeader — every chat column's title row, the single view and each
 * zone of a split alike: the chat's name, its "Forked from" / "Delegated by"
 * link (on a child), its delegated-tasks chip (on a parent), then on the
 * trailing edge the column's own session-details toggle and — for
 * a split zone — the zone close ✕.
 *
 * It sits INSIDE the transcript column (above the thread), so the docked
 * session panel beside it runs the chat area's full height. Name and fork
 * lineage resolve through `threadListItem`, which a zone rebinds — so each
 * half of a split titles itself.
 */
import { X } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { SessionPanelToggle } from '@/features/session-panel/SessionPanelToggle';
import type { PanelColumnId } from '@/features/session-panel/panel-control-store';
import { ChatHeaderParentLink } from './ChatHeaderParentLink';
import { ChatHeaderTasksChip } from '../orchestration/ChatHeaderTasksChip';

interface ChatColumnHeaderProps {
  columnId: PanelColumnId;
  toggleTestId: string;
  /** The tour's `session-rail` anchor rides the single view's toggle. */
  tourAnchor?: boolean;
  /** Set for a split zone: its id (testids) and the close action. */
  zone?: { chatId: string; onClose: () => void };
}

function useColumnTitle(): string {
  const title = useAuiState((s) => s.threadListItem?.title);
  const isDraft = useAuiState((s) => s.threadListItem?.id?.startsWith('__LOCALID_') ?? false);
  if (isDraft && !title) return 'New Session';
  return title || 'Untitled';
}

export function ChatColumnHeader({ columnId, toggleTestId, tourAnchor = false, zone }: ChatColumnHeaderProps) {
  const title = useColumnTitle();
  return (
    <div
      data-testid={zone ? `chat-zone-strip-${zone.chatId}` : 'chat-header'}
      className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4"
    >
      <span data-testid="chat-header-title" className="min-w-0 flex-initial truncate text-sm font-semibold">
        {title}
      </span>
      <ChatHeaderParentLink />
      <ChatHeaderTasksChip />
      <span className="flex-1" />
      <SessionPanelToggle columnId={columnId} testId={toggleTestId} tourAnchor={tourAnchor} />
      {zone && (
        <Hint label="Close zone">
          <Button
            data-testid={`chat-zone-close-${zone.chatId}`}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={(event) => {
              event.stopPropagation();
              zone.onClose();
            }}
          >
            <X className="size-4" />
          </Button>
        </Hint>
      )}
    </div>
  );
}

import React from 'react';
import { Eye } from 'lucide-react';
import { useUIStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

interface ChatActionsProps {
  chatId: string;
}

export function ChatActions({ chatId }: ChatActionsProps): React.ReactElement | null {
  const { setReviewPanelOpen } = useUIStore();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));

  if (!chat) return null;

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setReviewPanelOpen(true)}
            className="p-2 hover:bg-mf-surface-secondary rounded transition-colors"
            aria-label="Review changes"
            title="Review changes (Cmd+Shift+R)"
          >
            <Eye size={16} className="text-mf-text-secondary" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Review changes (Cmd+Shift+R)</TooltipContent>
      </Tooltip>
    </div>
  );
}

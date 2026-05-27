import React from 'react';
import { GitPullRequest } from 'lucide-react';
import { useChatsStore } from '../../store/chats';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { ScrollRow } from '../ui/scroll-row';

interface PrBadgeProps {
  chatId: string;
}

function openUrl(url: string): void {
  if (window.electron?.openExternal) {
    window.electron.openExternal(url).catch((err: unknown) => {
      console.warn('[PrBadge] openExternal failed', err);
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function PrBadge({ chatId }: PrBadgeProps): React.ReactElement | null {
  const prs = useChatsStore((s) => s.detectedPrs.get(chatId));

  if (!prs || prs.length === 0) return null;

  return (
    <ScrollRow data-testid="chat-pr-badges" className="min-w-0 flex-1">
      {prs.map((pr) => (
        <Tooltip key={`${pr.owner}/${pr.repo}/${pr.number}`}>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`chat-pr-open-${pr.owner}-${pr.repo}-${pr.number}`}
              onClick={() => openUrl(pr.url)}
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1a7f37] text-white hover:bg-[#2ea043] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
              aria-label={`Open PR #${pr.number} in ${pr.owner}/${pr.repo}`}
            >
              <GitPullRequest size={10} className="shrink-0" />
              <span>#{pr.number}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {pr.owner}/{pr.repo} #{pr.number}
          </TooltipContent>
        </Tooltip>
      ))}
    </ScrollRow>
  );
}

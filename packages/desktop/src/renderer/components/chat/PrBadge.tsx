import React from 'react';
import { GitPullRequest } from 'lucide-react';
import { useChatsStore } from '../../store/chats';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

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
    <div className="flex items-center gap-1">
      {prs.map((pr) => (
        <Tooltip key={`${pr.owner}/${pr.repo}/${pr.number}`}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => openUrl(pr.url)}
              className={
                pr.source === 'created'
                  ? 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1a7f37] text-white hover:bg-[#2ea043] transition-colors'
                  : 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-mf-text-secondary opacity-40 text-white hover:opacity-60 transition-colors'
              }
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
    </div>
  );
}

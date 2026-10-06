/**
 * UnlinkPairButton — drops the pairing between a task and its GitHub issue.
 *
 * Lives in the card's existing hover cluster, and renders nothing for an
 * unpaired task. Reads the pair from the store by `todo.id` so the card
 * grows no prop for it (D4). Board-only since the 2026-10 redesign (the list
 * view's row variant is gone).
 */
import React from 'react';
import { Unlink } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { runOrToast } from './run-or-toast';
import { useGitHubSyncStore } from './use-github-sync-store';

interface Props {
  todo: Todo;
}

const PREFIX = 'tasks-card';

export function UnlinkPairButton({ todo }: Props): React.ReactElement | null {
  const paired = useGitHubSyncStore((s) => s.pairs[todo.id] !== undefined);
  const unlinkPair = useGitHubSyncStore((s) => s.unlinkPair);

  if (!paired) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid={`${PREFIX}-unlink-${todo.number}`}
          onClick={(e) => {
            e.stopPropagation();
            void runOrToast('Unlink failed', () => unlinkPair(todo.id));
          }}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Unlink from the GitHub issue"
        >
          <Unlink size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Unlink from GitHub</TooltipContent>
    </Tooltip>
  );
}

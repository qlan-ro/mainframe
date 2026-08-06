/**
 * UnlinkPairButton — drops the pairing between a task and its GitHub issue.
 *
 * Lives in the row's and the card's existing hover cluster, and renders nothing
 * for an unpaired task. Reads the pair from the store by `todo.id` so neither
 * host component grows a prop (D4).
 */
import React from 'react';
import { Unlink } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@v2/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { runOrToast } from './run-or-toast';
import { useGitHubSyncStore } from './use-github-sync-store';

interface Props {
  todo: Todo;
  surface: 'list' | 'card';
}

const PREFIX: Record<Props['surface'], string> = {
  list: 'tasks-list-row',
  card: 'tasks-card',
};

export function UnlinkPairButton({ todo, surface }: Props): React.ReactElement | null {
  const paired = useGitHubSyncStore((s) => s.pairs[todo.id] !== undefined);
  const unlinkPair = useGitHubSyncStore((s) => s.unlinkPair);

  if (!paired) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid={`${PREFIX[surface]}-unlink-${todo.number}`}
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

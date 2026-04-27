import { GitBranch } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

interface Props {
  toolName: 'EnterWorktree' | 'ExitWorktree';
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function parseEnterResult(result: Props['result']): { worktreePath?: string; worktreeBranch?: string } {
  const text = typeof result === 'string' ? result : (result?.content ?? '');
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function WorktreeStatusPill({ toolName, args, result, isError }: Props) {
  const isEnter = toolName === 'EnterWorktree';
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));

  let label: React.ReactNode;
  let tooltip: string | null = null;

  if (errored) {
    label = isEnter ? 'Failed to enter worktree' : 'Failed to exit worktree';
    tooltip = typeof result === 'object' ? (result?.content ?? null) : (result ?? null);
  } else if (pending) {
    label = isEnter ? 'Entering worktree…' : 'Exiting worktree…';
  } else if (isEnter) {
    const { worktreePath, worktreeBranch } = parseEnterResult(result);
    const name = String(args.name ?? worktreeBranch ?? worktreePath ?? '');
    label = (
      <>
        Entered worktree: <span className="text-mf-accent">{name}</span>
      </>
    );
    tooltip = worktreePath ?? null;
  } else {
    const action = String(args.action ?? 'keep');
    label = action === 'remove' ? 'Removed worktree' : 'Exited worktree (kept)';
  }

  const pill = (
    <span
      className={
        errored
          ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
          : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50'
      }
    >
      <GitBranch size={12} className="text-mf-text-secondary shrink-0" />
      <span className="font-mono text-[11px] text-mf-text-secondary">{label}</span>
      {pending ? (
        <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
      ) : errored ? (
        <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
      ) : null}
    </span>
  );

  return (
    <div className="flex justify-center my-1">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
    </div>
  );
}

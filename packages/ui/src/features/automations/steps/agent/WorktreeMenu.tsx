/**
 * WorktreeMenu — the Agent card's worktree chip + popover (todo #234 T15).
 * The chip states where the step will run; the popover owns the isolate
 * switch, the branch name and the base branch.
 *
 * The branch name is a `'variables-only'` `TriggerTextField`: branch names
 * take `$refs` (`todo/$id`), never slash commands or `@`-files. Base
 * branches come from the automation's own resolved project
 * (`store.activeProjectId`) via `useProjectBranches` — the step needs no
 * project picker of its own.
 */
import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@v2/components/ui/popover';
import { Switch } from '@v2/components/ui/switch';
import { BranchSelect } from '@/features/git/BranchSelect';
import type { AskAgentStep } from '../../contract';
import { textToChipText } from '../../domain/chip-text-convert';
import { useAutomationsStore } from '../../data/use-automations-store';
import { TriggerTextField } from '../../fields/TriggerTextField';
import { singlePart } from '../action-fields';
import { useProjectBranches } from '../use-project-branches';
import { ChipButton } from './ChipButton';

type Worktree = NonNullable<AskAgentStep['worktree']>;

export interface WorktreeMenuProps {
  worktree: Worktree | undefined;
  onChange: (patch: Pick<AskAgentStep, 'worktree'>) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

export function WorktreeMenu({ worktree, onChange, tokens, testId }: WorktreeMenuProps) {
  const [open, setOpen] = useState(false);
  const activeProjectId = useAutomationsStore((s) => s.activeProjectId);
  const { branches, currentBranch } = useProjectBranches(activeProjectId);

  const branchName = worktree ? singlePart(worktree.branchName) : '';
  const summary = worktree ? branchName || 'new worktree' : 'no worktree';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton icon={GitBranch} label={`Worktree: ${summary}`} testId={`${testId}-worktree`} className="min-w-0">
          <span className={branchName ? 'max-w-40 truncate font-mono text-xs' : 'max-w-40 truncate'}>{summary}</span>
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent
        data-testid={`${testId}-worktree-menu`}
        align="start"
        sideOffset={6}
        className="w-72 flex flex-col gap-2.5 p-3"
      >
        <label className="flex items-center gap-2.5">
          <Switch
            data-testid={`${testId}-worktree-toggle`}
            checked={!!worktree}
            onCheckedChange={(on) => onChange({ worktree: on ? { baseBranch: 'main', branchName: [] } : undefined })}
          />
          <span className="text-xs text-foreground">Run in a fresh worktree</span>
        </label>

        {worktree && (
          <div className="flex flex-col gap-2">
            <TriggerTextField
              value={branchName}
              onChange={(next) => onChange({ worktree: { ...worktree, branchName: textToChipText(next) } })}
              scope={tokens}
              placeholder="branch name"
              triggers="variables-only"
              testId={`${testId}-worktree-branch`}
            />
            <div className="flex items-center gap-2.5">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">from</span>
              <div className="min-w-0 flex-1">
                <BranchSelect
                  value={worktree.baseBranch ?? ''}
                  options={branches}
                  currentBranch={currentBranch}
                  onChange={(baseBranch) => onChange({ worktree: { ...worktree, baseBranch } })}
                  testId={`${testId}-worktree-base`}
                />
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

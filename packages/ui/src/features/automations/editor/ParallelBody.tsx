/**
 * ParallelBody — a list of independent branches, each its own `Recipe`.
 *
 * Unlike Repeat, a branch here is authored, not derived from an item list —
 * "Branch 1"/"Branch 2" are positional labels, not data. Removing a branch
 * that already holds steps needs a confirm: it is the one destructive click
 * in this editor that has no undo, so losing authored work to a stray
 * click is the failure mode to guard against.
 */
import { Plus, X } from 'lucide-react';
import { requestConfirm } from '@/lib/confirm-bridge';
import type { ActionCatalogEntry, AutomationStep, ParallelBlock } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { Recipe } from './Recipe';

export interface ParallelBodyProps {
  step: ParallelBlock;
  onChange: (patch: Partial<ParallelBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

interface BranchProps {
  stepId: string;
  index: number;
  branch: AutomationStep[];
  canRemove: boolean;
  onChange: (next: AutomationStep[]) => void;
  onRemove: () => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

function Branch({ stepId, index, branch, canRemove, onChange, onRemove, tokens, catalog, issues, depth }: BranchProps) {
  return (
    <div data-testid={`automations-parallel-branch-${stepId}-${index}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Branch {index + 1}</span>
        {canRemove && (
          <button
            type="button"
            data-testid={`automations-parallel-branch-remove-${stepId}-${index}`}
            onClick={onRemove}
            aria-label={`Remove branch ${index + 1}`}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={10} aria-hidden />
          </button>
        )}
      </div>
      <Recipe
        steps={branch}
        onChange={onChange}
        tokens={tokens}
        catalog={catalog}
        issues={issues}
        depth={depth + 1}
        testId={`automations-parallel-recipe-${stepId}-${index}`}
      />
    </div>
  );
}

/** Empty branches vanish silently; a branch already holding steps needs a
 * confirm — it's the one destructive, no-undo click in this editor. */
async function confirmBranchRemoval(stepId: string, index: number, branch: AutomationStep[]): Promise<boolean> {
  if (branch.length === 0) return true;
  return requestConfirm({
    title: 'Remove this branch?',
    body: `Branch ${index + 1} has ${branch.length} step${branch.length === 1 ? '' : 's'} in it — removing the branch removes them too. This can't be undone.`,
    confirmLabel: 'Remove branch',
    destructive: true,
    testid: `automations-parallel-remove-confirm-${stepId}-${index}`,
  });
}

export function ParallelBody({ step, onChange, tokens, catalog, issues, depth }: ParallelBodyProps) {
  const branches = step.branches;

  function setBranch(index: number, next: AutomationStep[]) {
    const arr = branches.slice();
    arr[index] = next;
    onChange({ branches: arr });
  }

  async function removeBranch(index: number) {
    const branch = branches[index] ?? [];
    if (await confirmBranchRemoval(step.id, index, branch)) {
      onChange({ branches: branches.filter((_, i) => i !== index) });
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {branches.map((branch, i) => (
        <Branch
          key={i}
          stepId={step.id}
          index={i}
          branch={branch}
          canRemove={branches.length > 2}
          onChange={(next) => setBranch(i, next)}
          onRemove={() => void removeBranch(i)}
          tokens={tokens}
          catalog={catalog}
          issues={issues}
          depth={depth}
        />
      ))}
      <button
        type="button"
        data-testid={`automations-parallel-add-branch-${step.id}`}
        onClick={() => onChange({ branches: [...branches, []] })}
        className="inline-flex h-[26px] items-center gap-1.5 self-start rounded-md border border-dashed border-input px-2.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus size={11} aria-hidden />
        Add branch
      </button>
    </div>
  );
}

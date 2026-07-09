/**
 * WfStepList — recursive step-list editor.
 *
 * Renders one `WfbStepRow` per step in the list addressed by `path`, plus an
 * "Add step" affordance that inserts into that same list. Composite steps
 * (choose/foreach/parallel) recurse into nested `WfStepList`s via
 * `WfbStepRow`'s `draft`/`path`/`onRootChange` props. This creates a mutual
 * import with `WfbStepRow` — expected, since both only reference each other
 * inside render functions, not at module-eval time.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WfbStepRow } from './WfbStepRow';
import { WfStepLibrary } from './WfStepLibrary';
import { stubStep } from './wf-stubs';
import { getStepsAtPath, insertStepAtPath, patchStepAtPath, removeStepAtPath } from './wf-step-path';
import { scopeForPath } from './config/wf-scope';
import type { WfStepPath } from './config/wf-scope';
import type { WfDraft, WfStep } from './wf-draft-types';

export interface WfStepListProps {
  draft: WfDraft;
  path: WfStepPath;
  onRootChange: (nextRootSteps: WfStep[]) => void;
}

/** A stable, non-index add-button testid suffix: the owning step's domain id + arm/branch selector. */
function ownerTestIdSuffix(draft: WfDraft, path: WfStepPath): string {
  if (path.length === 0) return 'root';
  const last = path[path.length - 1]!;
  if (typeof last === 'number') {
    const parentList = getStepsAtPath(draft.steps, path.slice(0, -1));
    return parentList[last]?.id ?? 'unknown';
  }
  const stepIdx = path[path.length - 2];
  const parentList = getStepsAtPath(draft.steps, path.slice(0, -2));
  const owner = typeof stepIdx === 'number' ? parentList[stepIdx] : undefined;
  const selector = 'arm' in last ? `arm-${last.arm}` : `branch-${last.branch}`;
  return `${owner?.id ?? 'unknown'}-${selector}`;
}

export function WfStepList({ draft, path, onRootChange }: WfStepListProps): React.ReactElement {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const steps = getStepsAtPath(draft.steps, path);
  const addTestId =
    path.length === 0 ? 'workflows-builder-add-step' : `workflows-builder-add-step-${ownerTestIdSuffix(draft, path)}`;

  function addStep(kind: WfStep['kind']): void {
    onRootChange(insertStepAtPath(draft.steps, path, stubStep(kind)));
    setLibraryOpen(false);
  }

  return (
    <div className="relative">
      {steps.map((step, j) => {
        const rowPath: WfStepPath = [...path, j];
        return (
          <WfbStepRow
            key={step.id ?? j}
            step={step}
            index={j}
            scope={scopeForPath(draft, rowPath)}
            onPatch={(patch) => onRootChange(patchStepAtPath(draft.steps, rowPath, patch))}
            onRemove={() => onRootChange(removeStepAtPath(draft.steps, rowPath))}
            draft={draft}
            path={rowPath}
            onRootChange={onRootChange}
          />
        );
      })}
      {steps.length === 0 && <p className="px-0.5 py-1 text-caption text-mf-text-3">No steps yet.</p>}
      <button
        type="button"
        data-testid={addTestId}
        onClick={() => setLibraryOpen(true)}
        className={cn(
          'mt-[3px] inline-flex h-[28px] items-center gap-[6px] rounded-md border border-dashed border-mf-border-hover pl-[9px] pr-[11px]',
          'text-caption font-semibold text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Plus size={12} aria-hidden />
        Add step
      </button>
      {libraryOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-mf-scrim">
          <div className="h-[82vh] max-h-[720px] w-[720px] max-w-[92vw] overflow-hidden rounded-xl bg-card shadow-[var(--mf-shadow-pop)]">
            <WfStepLibrary onAdd={addStep} onClose={() => setLibraryOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

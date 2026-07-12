/**
 * AutomationsView — the shell: header + body switch (run | editor | describe
 * | library, in that precedence order). Phase 1 wires in `library/
 * LibraryList`; Phase 3 lazy-loads `editor/AutomationEditor`; Phase 5 lazy-
 * loads `run/RunView` and wires in `describe/DescribeFlow` (not lazy —
 * behind `DESCRIBE_ENABLED`, no heavy deps, reachable only from the empty-
 * library `BlankState`).
 */
import React, { lazy, Suspense } from 'react';
import { X, Zap } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore, selectPendingInteractionCount } from './data/use-automations-store';
import { DescribeFlow } from './describe/DescribeFlow';
import { LibraryList } from './library/LibraryList';

const AutomationEditor = lazy(() => import('./editor/AutomationEditor').then((m) => ({ default: m.AutomationEditor })));
const RunView = lazy(() => import('./run/RunView').then((m) => ({ default: m.RunView })));

function SectionFallback(): React.ReactElement {
  return <div className="flex flex-1 items-center justify-center text-label text-muted-foreground">Loading…</div>;
}

export function AutomationsView(): React.ReactElement {
  const close = useAutomationsNav((s) => s.close);
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const runId = useAutomationsNav((s) => s.runId);
  const describeOpen = useAutomationsNav((s) => s.describeOpen);
  const definitions = useAutomationsStore((s) => s.definitions);
  const pending = useAutomationsStore(selectPendingInteractionCount);

  return (
    <div data-testid="automations-view" className="flex h-full min-h-0 flex-col bg-card font-sans">
      <div className="flex h-[50px] flex-shrink-0 items-center gap-[11px] border-b border-border px-[14px]">
        <Hint label="Close">
          <button
            type="button"
            data-testid="automations-close"
            onClick={close}
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X size={15} aria-hidden />
          </button>
        </Hint>
        <Zap size={16} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">Workflows</span>
        <span data-testid="automations-title-count" className="text-caption text-muted-foreground">
          {definitions.length} automation{definitions.length === 1 ? '' : 's'}
          {pending > 0 ? ` · ${pending} need you` : ''}
        </span>
      </div>

      <Suspense fallback={<SectionFallback />}>
        <div className="min-h-0 flex-1 overflow-hidden">
          {runId ? (
            <div data-testid="automations-section-run" className="h-full overflow-hidden">
              <RunView />
            </div>
          ) : editorTarget ? (
            <div data-testid="automations-section-editor" className="h-full overflow-hidden">
              <AutomationEditor />
            </div>
          ) : describeOpen ? (
            <div data-testid="automations-section-describe" className="h-full overflow-hidden">
              <DescribeFlow />
            </div>
          ) : (
            <div data-testid="automations-section-library" className="h-full">
              <LibraryList />
            </div>
          )}
        </div>
      </Suspense>
    </div>
  );
}

/**
 * AutomationsView — the shell: header + body switch (run | editor | describe
 * | details | library, in that precedence order). Phase 1 wires in `library/
 * LibraryList`; Phase 3 lazy-loads `editor/AutomationEditor`; Phase 5 lazy-
 * loads `run/RunView` and wires in `describe/DescribeFlow` (not lazy —
 * behind `DESCRIBE_ENABLED`, no heavy deps, reachable only from the empty-
 * library `BlankState`); todo #233 lazy-loads `details/AutomationDetails`,
 * reached by clicking a library row.
 */
import React, { lazy, Suspense } from 'react';
import { X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { ModalProjectPicker } from '@/features/project-scope/ModalProjectPicker';
import { useProjects } from '@/features/sessions/use-projects';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsStore, selectPendingInteractionCount } from './data/use-automations-store';
import { DescribeFlow } from './describe/DescribeFlow';
import { LibraryList } from './library/LibraryList';

const AutomationEditor = lazy(() => import('./editor/AutomationEditor').then((m) => ({ default: m.AutomationEditor })));
const RunView = lazy(() => import('./run/RunView').then((m) => ({ default: m.RunView })));
const AutomationDetails = lazy(() =>
  import('./details/AutomationDetails').then((m) => ({ default: m.AutomationDetails })),
);

function SectionFallback(): React.ReactElement {
  return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading…</div>;
}

interface AutomationsViewProps {
  /** The open modal's scope, owned by `AutomationsHost`'s `useModalProjectScope`. */
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
}

export function AutomationsView({ projectId, onProjectChange }: AutomationsViewProps): React.ReactElement {
  const close = useAutomationsNav((s) => s.close);
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const runId = useAutomationsNav((s) => s.runId);
  const describeOpen = useAutomationsNav((s) => s.describeOpen);
  const detailsAutomationId = useAutomationsNav((s) => s.detailsAutomationId);
  const definitions = useAutomationsStore((s) => s.definitions);
  const pending = useAutomationsStore(selectPendingInteractionCount);
  const { projects } = useProjects();
  // A sub-view has its own project already baked into what it is showing —
  // re-scoping underneath it would strand the user's work.
  const inSubView = runId != null || editorTarget != null || describeOpen || detailsAutomationId != null;

  return (
    <div data-testid="automations-view" className="flex h-full min-h-0 flex-col bg-card font-sans">
      {/* Header band. Close sits at the far RIGHT — every dialog closes on the
          right (stock shadcn position); the old left-side X predates the port. */}
      <div className="flex h-[52px] flex-shrink-0 items-center gap-2.5 border-b px-4">
        <Zap size={16} className="text-primary" aria-hidden />
        <span className="text-base font-semibold text-foreground">Workflows</span>
        <ModalProjectPicker
          surface="automations"
          projectId={projectId}
          projects={projects}
          onSelect={onProjectChange}
          allowAllProjects
          disabled={inSubView}
        />
        <span data-testid="automations-title-count" className="text-xs text-muted-foreground">
          {definitions.length} automation{definitions.length === 1 ? '' : 's'}
          {pending > 0 ? ` · ${pending} need you` : ''}
        </span>
        <div className="flex-1" />
        <Hint label="Close">
          <Button variant="ghost" size="icon-sm" data-testid="automations-close" onClick={close} aria-label="Close">
            <X aria-hidden />
          </Button>
        </Hint>
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
          ) : detailsAutomationId ? (
            <div data-testid="automations-section-details" className="h-full overflow-hidden">
              <AutomationDetails />
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

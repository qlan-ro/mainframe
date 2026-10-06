/**
 * AutomationsView — the shell: a header (details only) + body switch
 * (editor | describe | details, in that precedence order; an empty state
 * otherwise). 2026-10 redesign: the body never lists automations again — the
 * sidebar list (`sidebar-list/AutomationsSidebarList`) is the only "browse"
 * surface, so there is no library section, no "Workflows" breadcrumb/count,
 * and no back button here any more.
 *
 * `AutomationDetails` (details/AutomationDetails.tsx) owns the one case that
 * still needs a header row: it portals the automation's name, a run-status
 * suffix and its actions into the slot below. The editor and Describe already
 * draw their own self-contained header bar (a back button + icon + title) —
 * `AutomationEditor.tsx`/`describe/DescribeFlow.tsx` — so this view's header
 * stays hidden while either is open, rather than doubling up.
 */
import React, { lazy, Suspense, useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutomationsHeaderSlot } from './header-slot';
import { useAutomationsNav } from './data/use-automations-nav';
import { useAutomationsLibraryView } from './data/use-automations-scope';
import { DescribeFlow } from './describe/DescribeFlow';
import { BlankState } from './library/BlankState';
import { DESCRIBE_ENABLED } from './flags';

const AutomationEditor = lazy(() => import('./editor/AutomationEditor').then((m) => ({ default: m.AutomationEditor })));
const AutomationDetails = lazy(() =>
  import('./details/AutomationDetails').then((m) => ({ default: m.AutomationDetails })),
);

function SectionFallback(): React.ReactElement {
  return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading…</div>;
}

/**
 * Nothing selected: `BlankState`'s two creation paths when the scope has no
 * automations at all, else a quiet "pick one from the sidebar" prompt — the
 * sidebar list is the only place to browse, so this is never a second
 * library.
 */
function EmptyBody({ hasAny, onNew }: { hasAny: boolean; onNew: () => void }): React.ReactElement {
  const openDescribe = useAutomationsNav((s) => s.openDescribe);

  if (!hasAny) {
    return (
      <div data-testid="automations-blank" className="h-full">
        <BlankState onDescribe={openDescribe} onBuild={onNew} describeEnabled={DESCRIBE_ENABLED} />
      </div>
    );
  }

  return (
    <div data-testid="automations-empty" className="flex h-full flex-col items-center justify-center gap-[12px]">
      <span className="text-sm text-muted-foreground">Select an automation</span>
      <Button size="sm" data-testid="automations-empty-new" onClick={onNew}>
        <Plus aria-hidden />
        New automation
      </Button>
    </div>
  );
}

export function AutomationsView(): React.ReactElement {
  const editorTarget = useAutomationsNav((s) => s.editorTarget);
  const describeOpen = useAutomationsNav((s) => s.describeOpen);
  const detailsAutomationId = useAutomationsNav((s) => s.detailsAutomationId);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const { definitions } = useAutomationsLibraryView();

  // Only Details uses the shared header slot — editor/describe draw their own.
  const showDetailsHeader = editorTarget == null && !describeOpen && detailsAutomationId != null;

  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  return (
    <div data-testid="automations-view" className="flex h-full min-h-0 flex-col bg-background font-sans">
      {showDetailsHeader && (
        <div className="flex h-[52px] flex-shrink-0 items-center gap-2.5 border-b px-4">
          <Zap size={16} className="text-primary" aria-hidden />
          <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center gap-2.5" />
        </div>
      )}

      <AutomationsHeaderSlot.Provider value={headerSlot}>
        <Suspense fallback={<SectionFallback />}>
          <div className="min-h-0 flex-1 overflow-hidden">
            {editorTarget ? (
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
              <EmptyBody hasAny={definitions.length > 0} onNew={() => openEditor({ mode: 'new' })} />
            )}
          </div>
        </Suspense>
      </AutomationsHeaderSlot.Provider>
    </div>
  );
}

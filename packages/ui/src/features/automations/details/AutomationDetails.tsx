/**
 * AutomationDetails — the Automations rail's single per-automation view
 * (todo #233; 2026-10 redesign retired its Runs/Overview tab switch): a
 * header (name + run-status suffix + actions) portaled into the shared slot,
 * a second-level `RunsColumn`, and the body that column's selection drives —
 * `DetailsOverview` or a run's trace (`run/RunTrace`). There is only ever ONE
 * automation open at a time; the sidebar list is the only "browse" surface.
 *
 * Self-sufficient like `AutomationEditor`/`RunTrace`: reads
 * `use-automations-nav`/`use-automations-store` directly rather than taking
 * props — `AutomationsView` only decides WHETHER to mount this.
 */
import { useEffect, useMemo } from 'react';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';
import { useAutomationsNav } from '../data/use-automations-nav';
import { selectAutomationById, useAutomationsStore } from '../data/use-automations-store';
import { runsForAutomation } from '../data/library-cache';
import { RUN_STATUS_LABEL } from '../library/LastRunPill';
import { DetailsOverview } from './DetailsOverview';
import { DetailsHeaderActions } from './DetailsHeaderActions';
import { RunsColumn } from './RunsColumn';
import { RunTrace } from '../run/RunTrace';
import { AutomationsHeaderPortal } from '../header-slot';

export function AutomationDetails() {
  const automationId = useAutomationsNav((s) => s.detailsAutomationId);
  const selectedRunId = useAutomationsNav((s) => s.selectedRunId);
  const selectRun = useAutomationsNav((s) => s.selectRun);
  const automation = useAutomationsStore(selectAutomationById(automationId));
  const libraries = useAutomationsStore((s) => s.libraries);
  const catalog = useAutomationsStore((s) => s.catalog);

  const runs = useMemo(
    () => (automationId == null ? [] : runsForAutomation(libraries, automationId)),
    [libraries, automationId],
  );

  // Opening an automation that already ran lands on its most recent run —
  // "click an automation, see its latest run's trace already open" (2026-10
  // redesign). Keyed on automationId alone, not `runs`, so it fires once per
  // open rather than snapping back to the latest run on every later WS
  // update once the user has picked something else (Overview, an older run).
  useEffect(() => {
    if (automationId == null || selectedRunId != null || runs.length === 0) return;
    selectRun(runs[0]!.id);
  }, [automationId]);

  if (!automationId) return null;

  if (!automation) {
    return (
      <div
        data-testid="automations-details-not-found"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        This automation couldn't be found.
      </div>
    );
  }

  const selectedRun = selectedRunId == null ? undefined : runs.find((r) => r.id === selectedRunId);
  const isLatestRun = selectedRun != null && runs[0]?.id === selectedRun.id;

  return (
    <div data-testid="automations-details" className="flex h-full min-h-0">
      <AutomationsHeaderPortal>
        <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground">
          {automation.name}
          {selectedRun && (
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              · {RUN_STATUS_LABEL[selectedRun.status].toLowerCase()}{' '}
              {formatRelativeTime(selectedRun.startedAt, Date.now())}
            </span>
          )}
        </span>
        <DetailsHeaderActions automation={automation} />
      </AutomationsHeaderPortal>

      <RunsColumn runs={runs} selectedRunId={selectedRunId} onSelect={selectRun} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedRun ? (
          <RunTrace runId={selectedRun.id} forceOpenDefault={isLatestRun} />
        ) : (
          <DetailsOverview description={automation.description} definition={automation.definition} catalog={catalog} />
        )}
      </div>
    </div>
  );
}

/**
 * The workflow run panel: header, phases, agent rows. Opened from the transcript's
 * launcher row (anchored to itself) or from the Activity card's drill-in, which
 * renders its own breadcrumb.
 *
 * Height comes from the column, not a magic max-height: the shell caps and the body
 * scrolls. Every child renders the neutralized run, so a terminal run never shows an
 * agent as live (A9).
 */
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { neutralizedRun } from './workflow-agent-view';
import { runKey } from './workflow-progress';
import { WorkflowPhaseList } from './WorkflowPhaseList';
import { WorkflowRunPanelHeader } from './WorkflowRunPanelHeader';
import { WorkflowRunUnavailable } from './WorkflowRunUnavailable';
import { WorkflowStaleBanner } from './WorkflowStaleBanner';

export function WorkflowRunPanel({ run }: { run: ClaudeWorkflowRun }) {
  const now = Date.now();
  const view = neutralizedRun(run, now);
  const key = runKey(view);

  return (
    <div data-testid={`chat-workflow-panel-${key}`} className="flex max-h-[min(440px,56vh)] flex-col">
      <WorkflowRunPanelHeader run={view} now={now} />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
        {view.status === 'unavailable' ? (
          <WorkflowRunUnavailable />
        ) : (
          <>
            <WorkflowStaleBanner run={view} now={now} />
            <WorkflowPhaseList run={view} />
          </>
        )}
      </div>
    </div>
  );
}

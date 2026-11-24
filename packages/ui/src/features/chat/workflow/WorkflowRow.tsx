/**
 * The `Workflow` / `RunWorkflow` call: a row that never unfolds. Pressing it
 * opens the run's panel, anchored to itself. A launch that never produced a run
 * id (a failure, or a call still in flight) has no panel to open.
 */
import { PanelRight } from 'lucide-react';
import type { ClaudeWorkflowRunStatus } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNow } from '@/lib/use-now';
import { RowDisclosure } from '../messages/turn/RowDisclosure';
import { RowGlyph } from '../messages/turn/RowGlyph';
import { KIND_ICONS, STATUS_WORDS, type RowStatus } from '../messages/turn/tool-icons';
import { useToolFacts, type ToolRowProps } from '../messages/turn/ToolRow';
import { resolveResultText } from '../tools/shared';
import { neutralizedRun } from './workflow-agent-view';
import { parseWorkflowLaunch, runMetaString, unavailableRun } from './workflow-progress';
import { useWorkflowRun } from './use-workflow-run';
import { WorkflowRunPanel } from './WorkflowRunPanel';

/** A run with failed agents still completed; its receipt counts them. */
const RUN_STATUS: Record<ClaudeWorkflowRunStatus, RowStatus> = {
  running: 'running',
  completed: 'success',
  failed: 'failed',
  stopped: 'stopped',
  paused: 'stopped',
  unavailable: 'unknown',
};

export function WorkflowRow({ unit, part }: ToolRowProps) {
  const facts = useToolFacts(part);
  const launch = parseWorkflowLaunch(resolveResultText(part.result).text);
  const run = useWorkflowRun(launch.taskId);
  const now = useNow();
  const name = launch.workflowName ?? run?.workflowName ?? (facts.target || 'Workflow');
  const started = launch.runId !== undefined && !launch.error;
  const effective = started ? (run ?? unavailableRun(launch)) : undefined;
  const view = effective && neutralizedRun(effective, now);
  const status: RowStatus = launch.error ? 'failed' : view ? RUN_STATUS[view.status] : facts.status;
  const receipt = launch.error ?? (view ? runMetaString(view, now) : (facts.receipt ?? 'Starting…'));
  const row = (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-workflow-launcher-${launch.runId ?? part.toolCallId}`}
      name={`${facts.verb} ${name}`}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS.workflow} status={status} />}
      verb={facts.verb}
      target={name}
      mono
      receipt={receipt}
      tone={status === 'failed' ? 'fail' : undefined}
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
      press={
        effective && (
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={`chat-workflow-launcher-open-${launch.runId}`}
              aria-label={`Open the run of ${name}`}
            />
          </PopoverTrigger>
        )
      }
      trailing={effective && <PanelRight aria-hidden className="size-3.5!" />}
    />
  );
  if (!effective) return row;
  return (
    <Popover>
      {row}
      {/* `overflow-hidden`: the panel's header band runs edge to edge, and
          PopoverContent does not clip it to the rounded corner. */}
      <PopoverContent
        align="start"
        className="w-[380px] overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <WorkflowRunPanel run={effective} />
      </PopoverContent>
    </Popover>
  );
}

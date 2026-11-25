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
import { useFailedOpen } from '../messages/turn/use-failed-open';
import { useTranscriptScope } from '../messages/turn/transcript-scope';
import { useTurnSelector } from '../messages/turn/turn-context';
import { ResultBlock } from '../tools/bodies/ResultText';
import { KeyValue, Surface } from '../tools/bodies/Surface';
import { resolveResultText } from '../tools/shared';
import type { ToolPart } from '../view-model/turn/types';
import { neutralizedRun } from './workflow-agent-view';
import { parseWorkflowLaunch, runMetaString, unavailableRun } from './workflow-progress';
import { useWorkflowRun } from './use-workflow-run';
import { WorkflowRunPanel } from './WorkflowRunPanel';

function LaunchBody({ part, failed, error }: { part: ToolPart; failed: boolean; error?: string }) {
  const testId = `chat-workflow-launcher-result-${part.toolCallId}`;
  if (!error) return <ResultBlock part={part} failed={failed} testId={testId} />;
  return (
    <Surface>
      <KeyValue label="Error" tone="fail" testId={testId}>
        {error}
      </KeyValue>
    </Surface>
  );
}

/** A run with failed agents still completed; its receipt counts them. */
const RUN_STATUS: Record<ClaudeWorkflowRunStatus, RowStatus> = {
  running: 'running',
  completed: 'success',
  failed: 'failed',
  stopped: 'stopped',
  paused: 'stopped',
  unavailable: 'unknown',
};

/** A run the record left running is believed only while its turn runs or the daemon still holds its task. */
function useCutShort(toolCallId: string, turnKey: string | undefined): boolean {
  const { live } = useTranscriptScope();
  const going = useTurnSelector(({ children }) => children.byCall.has(toolCallId), true);
  return turnKey !== undefined && live === false && !going;
}

export function WorkflowRow({ unit, part, turnKey }: ToolRowProps) {
  const facts = useToolFacts({ unit, part });
  const cutShort = useCutShort(part.toolCallId, turnKey);
  const failedOpen = useFailedOpen(turnKey, part.toolCallId);
  const launch = parseWorkflowLaunch(resolveResultText(part.result).text);
  const run = useWorkflowRun(launch.taskId);
  const now = useNow();
  const name = launch.workflowName ?? run?.workflowName ?? (facts.target || 'Workflow');
  const started = launch.runId !== undefined && !launch.error;
  const effective = started ? (run ?? unavailableRun(launch)) : undefined;
  // Nothing holds it, and nothing says how it ended.
  const lost = effective?.status === 'running' && cutShort;
  const view = effective && neutralizedRun(lost ? { ...effective, status: 'unavailable' } : effective, now);
  const status: RowStatus = launch.error ? 'failed' : view ? RUN_STATUS[view.status] : facts.status;
  const receipt = view ? runMetaString(view, now) : launch.error ? 'failed' : (facts.receipt ?? 'Starting…');
  // No run came of it: whatever the call answered is all there is.
  const said = effective ? '' : resolveResultText(part.result).text;
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
      defaultOpen={failedOpen || launch.error !== undefined}
    >
      {said ? <LaunchBody part={part} failed={status === 'failed'} error={launch.error} /> : undefined}
    </RowDisclosure>
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

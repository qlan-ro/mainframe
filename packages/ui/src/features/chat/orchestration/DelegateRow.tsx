/**
 * A delegated task (T1c): the same row as a sub-agent's, with the filled robot
 * and the provider it went to. The task's own chat supplies its title, status
 * and steps; opening the row is what attaches that chat's stream. Its result
 * lands here, in place of the message the parent receives (T1f). The row opens
 * itself when the task starts waiting on you.
 */
import { lazy, Suspense, useEffect } from 'react';
import { PanelRight } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { isTerminalTaskStatus, type TaskStatus } from '@qlan-ro/mainframe-types';
import { delegatedStopKey, useStop } from '@/features/session-panel/use-stop';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { openTaskTab } from '@/features/workspace-chat/open-session';
import { cancelDelegatedTask } from '@/lib/api/background-tasks';
import { useAdaptersStore } from '@/store/adapters';
import { AgentSteps } from '../messages/turn/AgentSteps';
import { RowAction, RowDisclosure } from '../messages/turn/RowDisclosure';
import { RowGlyph } from '../messages/turn/RowGlyph';
import { StopAction } from '../messages/turn/StopAction';
import { useToolFacts, type ToolRowProps } from '../messages/turn/ToolRow';
import { KIND_ICONS, STATUS_WORDS, type RowStatus } from '../messages/turn/tool-icons';
import { useFailedOpen } from '../messages/turn/use-failed-open';
import { useRowOpen } from '../messages/turn/use-row-open';
import { BodyNote } from '../tools/bodies/Surface';
import { resolveResultText } from '../tools/shared';
import { argText } from '../view-model/turn/tool-values';
import { rowName } from '../view-model/turn/tool-row';
import type { ToolPart } from '../view-model/turn/types';
import { isTaskStatus, parseDelegateResult, type DelegateResult } from './delegate-result';
import { resumed, taskStatusOf } from './task-standing';
import { useTaskResult } from './use-task-result';
import type { TaskResultMarker } from '../markers/agent-message';
import { agentOutcome } from '../messages/turn/agent-outcome';
import { ResultText } from '../tools/bodies/ResultText';
import { useTranscriptScope } from '../messages/turn/transcript-scope';
import { findSession, useSessionItems } from './use-session-items';

const TaskChatSteps = lazy(() => import('./TaskChatSteps').then((module) => ({ default: module.TaskChatSteps })));

const STATUSES: Record<TaskStatus, RowStatus> = {
  queued: 'queued',
  running: 'running',
  waiting: 'needs-you',
  completed: 'success',
  failed: 'failed',
  cancelled: 'stopped',
  interrupted: 'interrupted',
};
const RECEIPTS: Partial<Record<RowStatus, string>> = {
  queued: 'queued',
  running: 'running',
  'needs-you': 'waiting on you',
  success: 'completed',
  failed: 'failed',
  stopped: 'stopped',
  interrupted: 'interrupted',
  unknown: 'no result',
};
const NOTES: Partial<Record<RowStatus, string>> = {
  queued: 'Starts when a slot frees up.',
  stopped: 'Stopped.',
  interrupted: 'Interrupted when the daemon restarted. Open its chat to continue.',
};

/**
 * The child's list row, whether it (or a task below it) waits on the user, and
 * how to open it: as a workspace tab beside the parent, which stays the
 * conversation (W8). Opening an archived child restores it.
 */
function useTaskChild(childChatId: string | undefined) {
  const aui = useAui();
  const items = useSessionItems();
  const child = childChatId == null ? undefined : findSession(items, childChatId);
  const needsYou = child != null && (child.custom.hasPending || child.custom.delegatedWaiting === true);
  const openChild = child == null ? undefined : () => openTaskTab(aui.threads, child.id);
  return { child, needsYou, openChild };
}

/** The task itself is live: its own stop route, as the panel's and its tab's. Not a finished one whose chat goes on. */
function useTaskStop(title: string, task: TaskStatus | undefined, taskId = '', custom?: SessionCustom) {
  const parent = custom?.delegation?.taskId === taskId ? custom.parentChatId : undefined;
  const live = parent != null && task !== undefined && !isTerminalTaskStatus(task);
  return useStop(title, live ? () => cancelDelegatedTask(parent, taskId) : undefined, delegatedStopKey(parent, taskId));
}

interface Standing {
  call: RowStatus;
  parsed: DelegateResult | null;
  task: TaskStatus | undefined;
  needsYou: boolean;
  /** The task's chat runs. */
  going: boolean;
  /** The turn that delegated it does. */
  live: boolean;
}

function rowStatus({ call, parsed, task, needsYou, going, live }: Standing): RowStatus {
  if (needsYou) return 'needs-you';
  if (task) return resumed(task, going) ? 'running' : STATUSES[task];
  if (!parsed) return call;
  // Launched, and nothing says how it stands: its chat is not listed (yet) and no result came back.
  return live ? STATUSES[parsed.status ?? 'running'] : 'unknown';
}

/** Opened again each time the task starts waiting on the user; the viewer can still close it. */
function useOpenOnNeed(rowKey: string, needsYou: boolean): void {
  const { setOpen } = useRowOpen(rowKey);
  useEffect(() => {
    if (needsYou) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the change opens it
  }, [needsYou]);
}

interface TaskBodyProps {
  part: ToolPart;
  parsed: DelegateResult | null;
  status: RowStatus;
  messageId: string;
  result: TaskResultMarker | undefined;
  onOpen?: () => void;
}

/** What the task brought back: delivered, returned by a call that waited, or why it was refused. */
function resultText({ part, parsed, result, status }: TaskBodyProps): string | undefined {
  if (result?.body) return result.body;
  if (parsed) return [parsed.error, parsed.summary].filter(Boolean).join('\n\n') || undefined;
  return status === 'failed' ? resolveResultText(part.result).text : undefined;
}

function TaskBody(props: TaskBodyProps) {
  const { part, parsed, status, messageId, onOpen } = props;
  const refused = !parsed && resolveResultText(part.result).truncated;
  const note = NOTES[status];
  const shared = {
    messageId,
    toolCallId: part.toolCallId,
    promptLabel: 'Task',
    prompt: argText(part, 'task'),
    outcome: agentOutcome(status),
    result: resultText(props),
    resultBody: refused && <ResultText part={part} />,
  };
  return (
    <div data-testid={parsed ? `chat-tool-delegate-task-body-${parsed.taskId}` : 'chat-tool-delegate-task-prompt'}>
      {parsed ? (
        <Suspense fallback={null}>
          <TaskChatSteps chatId={parsed.childChatId} taskId={parsed.taskId} onOpen={onOpen} {...shared} />
        </Suspense>
      ) : (
        <AgentSteps messages={[]} {...shared} />
      )}
      {note && <BodyNote>{note}</BodyNote>}
    </div>
  );
}

export function DelegateRow({ unit, part, turnKey }: ToolRowProps) {
  const facts = useToolFacts({ unit, part });
  const parsed = part.isError ? null : parseDelegateResult(resolveResultText(part.result).text);
  const { child, needsYou, openChild } = useTaskChild(parsed?.childChatId);
  const result = useTaskResult(parsed?.taskId);
  const live = useTranscriptScope().live !== false;
  const task = taskStatusOf({
    delivered: isTaskStatus(result?.status) ? result.status : undefined,
    listed: child?.custom.delegation?.status,
    launched: parsed?.status,
  });
  const going = child?.custom.isRunning === true;
  const status = rowStatus({ call: facts.status, parsed, task, needsYou, going, live });
  const adapterId = child?.custom.adapterId ?? argText(part, 'adapterId');
  const provider = useAdaptersStore((state) => state.byId[adapterId]?.name ?? adapterId);
  const title = child?.title ?? parsed?.title ?? (facts.target || 'Task');
  useOpenOnNeed(unit.key, needsYou);
  const failedOpen = useFailedOpen(turnKey, part.toolCallId, unit.key, unit.messageId);
  const { onStop, stopping } = useTaskStop(title, task, parsed?.taskId, child?.custom);
  const archived = child?.status === 'archived';
  const row = { ...facts, verb: 'Delegated', target: title, where: provider ? `to ${provider}` : undefined };
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId="chat-tool-delegate-task-card"
      name={rowName(row)}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS.delegate} status={status} />}
      verb={row.verb}
      target={title}
      where={row.where}
      receipt={<span data-status={status}>{RECEIPTS[status] ?? facts.receipt}</span>}
      tone={status === 'failed' ? 'fail' : status === 'needs-you' ? 'warn' : undefined}
      actions={
        parsed && openChild ? (
          <>
            {onStop && (
              <StopAction
                title={title}
                testId={`chat-tool-delegate-task-stop-${parsed.taskId}`}
                stopping={stopping}
                onStop={onStop}
              />
            )}
            <RowAction
              label={archived ? `Restore ${title} and open it in the workspace` : `Open ${title} in the workspace`}
              testId={`chat-tool-delegate-task-open-${parsed.taskId}`}
              onClick={openChild}
            >
              <PanelRight />
            </RowAction>
          </>
        ) : undefined
      }
      defaultOpen={failedOpen}
      steps
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      <TaskBody
        part={part}
        parsed={parsed}
        status={status}
        messageId={unit.messageId}
        result={result}
        onOpen={openChild}
      />
    </RowDisclosure>
  );
}

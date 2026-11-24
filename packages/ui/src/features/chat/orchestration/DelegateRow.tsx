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
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { useAdaptersStore } from '@/store/adapters';
import { AgentSteps } from '../messages/turn/AgentSteps';
import { RowAction, RowDisclosure } from '../messages/turn/RowDisclosure';
import { RowGlyph } from '../messages/turn/RowGlyph';
import { useToolFacts, type ToolRowProps } from '../messages/turn/ToolRow';
import { KIND_ICONS, STATUS_WORDS, type RowStatus } from '../messages/turn/tool-icons';
import { useFailedOpen } from '../messages/turn/use-failed-open';
import { useRowOpen } from '../messages/turn/use-row-open';
import { BodyNote } from '../tools/bodies/Surface';
import { resolveResultText } from '../tools/shared';
import { argText } from '../view-model/turn/tool-values';
import { rowName } from '../view-model/turn/tool-row';
import type { ToolPart } from '../view-model/turn/types';
import { parseDelegateResult, type DelegateResult } from './delegate-result';
import { useTaskResult } from './use-task-result';
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
};
const NOTES: Partial<Record<RowStatus, string>> = {
  queued: 'Starts when a slot frees up.',
  stopped: 'Stopped.',
  interrupted: 'Interrupted when the daemon restarted. Open its chat to continue.',
};

/**
 * The child's list row, whether it (or a task below it) waits on the user, and
 * how to open it: beside the parent, via the same `openInSplit` gesture the tab
 * strip's ⌘-click uses, never a plain `switchToThread` that would replace the
 * parent on screen. `switchToThread` then only moves focus onto it, which also
 * unarchives an archived child.
 */
function useTaskChild(childChatId: string | undefined) {
  const aui = useAui();
  const items = useSessionItems();
  const child = childChatId == null ? undefined : findSession(items, childChatId);
  const needsYou = child != null && (child.custom.hasPending || child.custom.delegatedWaiting === true);
  const openChild =
    child == null
      ? undefined
      : () => {
          const { mainThreadId } = aui.threads.getState();
          openInSplit(mainThreadId, child.id);
          aui.threads.switchToThread(child.id);
        };
  return { child, needsYou, openChild };
}

function rowStatus(call: RowStatus, task: TaskStatus | undefined, needsYou: boolean, going: boolean): RowStatus {
  if (needsYou) return 'needs-you';
  if (!task) return call;
  // A finished task's chat can be resumed. A stopped one is stopped, even while its chat winds down.
  if (isTerminalTaskStatus(task) && task !== 'cancelled' && going) return 'running';
  return STATUSES[task];
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
  onOpen?: () => void;
}

function TaskBody({ part, parsed, status, messageId, onOpen }: TaskBodyProps) {
  const result = useTaskResult(parsed?.taskId);
  const failed = status === 'failed';
  const text = result?.body ?? (failed && !parsed ? resolveResultText(part.result).text : undefined);
  const note = NOTES[status];
  const shared = {
    messageId,
    toolCallId: part.toolCallId,
    promptLabel: 'Task',
    prompt: argText(part, 'task'),
    result: text,
    failed,
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
  const facts = useToolFacts(part);
  const parsed = part.isError ? null : parseDelegateResult(resolveResultText(part.result).text);
  const { child, needsYou, openChild } = useTaskChild(parsed?.childChatId);
  const task = child?.custom.delegation?.status ?? parsed?.status;
  const status = rowStatus(facts.status, task, needsYou, child?.custom.isRunning === true);
  const adapterId = child?.custom.adapterId ?? argText(part, 'adapterId');
  const provider = useAdaptersStore((state) => state.byId[adapterId]?.name ?? adapterId);
  const title = child?.title ?? parsed?.title ?? (facts.target || 'Task');
  useOpenOnNeed(unit.key, needsYou);
  const failedOpen = useFailedOpen(turnKey, part.toolCallId);
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
          <RowAction
            label={archived ? `Restore and open ${title} beside this chat` : `Open ${title} beside this chat`}
            testId={`chat-tool-delegate-task-open-${parsed.taskId}`}
            onClick={openChild}
          >
            <PanelRight />
          </RowAction>
        ) : undefined
      }
      defaultOpen={failedOpen}
      steps
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      <TaskBody part={part} parsed={parsed} status={status} messageId={unit.messageId} onOpen={openChild} />
    </RowDisclosure>
  );
}

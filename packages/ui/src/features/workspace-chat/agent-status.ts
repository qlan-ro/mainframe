import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { isErrorResult, resolveResultText } from '@/features/chat/tools/shared';
import { agentTurns, completedChildAnswer, startedInCutTurn } from './agent-turns';
import type { AgentStatus } from './ConversationHeader';
import { toolCallIdsOf, type SubagentCall } from './find-subagent-call';

export interface AgentState {
  status: AgentStatus;
  /** Instead of the status's own word: how many of several agents it is true of. */
  label?: string;
}

/** A call's tasks: several for Codex agents that share one, or one that is talked to again. Null until listed. */
export type AgentTasks = readonly BackgroundTask[] | null;

const CODEX_AGENT = 'CollabAgent';

export const isCodexAgent = (call: SubagentCall): boolean => call.part.toolName === CODEX_AGENT;

const isFailed = ({ part }: SubagentCall) => part.result !== undefined && isErrorResult(part.result, part.isError);

const answerOf = ({ part }: SubagentCall) =>
  part.result === undefined ? '' : resolveResultText(part.result).text.trim();

/** The run that could still answer the call: a request waiting on the user pauses it, but doesn't end it. */
const isRunGoing = ({ runState }: ChatThreadState) => runState.type === 'running' || runState.type === 'cancelling';

/** True for a user message the model has, as opposed to one queued or still on its way. */
function isDelivered(message: ThreadMessage): boolean {
  const meta = message.metadata?.custom?.mainframe as { queued?: boolean; pending?: boolean } | undefined;
  return meta?.queued !== true && meta?.pending !== true;
}

function isCancelled(call: SubagentCall): boolean {
  const lifecycle = call.part.providerMetadata?.mainframe as { acpStatus?: string } | undefined;
  return lifecycle?.acpStatus === 'cancelled';
}

interface Facts {
  call: SubagentCall;
  /** The parent chat, and its transcript. */
  state: ChatThreadState;
  messages: readonly ThreadMessage[];
  tasks: AgentTasks;
}

function needsYou({ call, state }: Facts): boolean {
  const pending = new Set(Object.values(state.interactions.permissions).map((entry) => entry.request.toolUseId));
  return toolCallIdsOf(call.part.messages ?? []).some((id) => pending.has(id));
}

/**
 * A call with no answer, whose agent no task reports on. It goes on in the turn
 * that made it. A user message after it may have ended that turn or steered it,
 * so past one there is only the missing result to tell.
 */
function foregroundRunning({ call, state, messages }: Facts): boolean {
  const at = messages.findIndex((message) => message.id === call.messageId);
  return (
    isRunGoing(state) && !messages.slice(at + 1).some((message) => message.role === 'user' && isDelivered(message))
  );
}

interface Evidence {
  codex: boolean;
  background: boolean;
  explicitForeground: boolean;
  needsPermission: boolean;
  cancelled: boolean;
  foregroundRunning: boolean;
  parentRunning: boolean;
  failed: boolean;
  answer: string;
  childAnswer: string;
  childTurns: ReturnType<typeof agentTurns>;
  parentCut: boolean;
  tasks: AgentTasks;
  tasksFresh: boolean;
}

interface AgentPresentation {
  state: AgentState | null;
  result: string;
  runningTask?: BackgroundTask;
}

export function presentAgent(e: Evidence): AgentPresentation {
  const running = e.tasks?.filter((task) => task.status === 'running') ?? [];
  const settled = e.tasks?.filter((task) => task.status !== 'running') ?? [];
  const allDone =
    e.childTurns.length >= Math.max(1, e.tasks?.length ?? 0) && e.childTurns.every((turn) => turn === 'completed');
  const cutWithoutCompletion = e.codex && e.parentCut && !allDone;
  const result = e.codex
    ? cutWithoutCompletion && !e.failed
      ? e.childAnswer
      : e.answer
    : e.failed || !e.background
      ? e.answer
      : running.length
        ? ''
        : latestSummary(settled);
  const show = (status: AgentStatus | null, label?: string): AgentPresentation => ({
    state: status === null ? null : { status, label },
    result,
    runningTask: e.tasksFresh ? running[0] : undefined,
  });
  const missing = result ? null : 'no-result';
  if (e.needsPermission) return show('needs-you');
  if (running.length)
    return e.tasksFresh ? show('running', running.length > 1 ? `${running.length} running` : undefined) : show(null);

  const failed = e.childTurns.filter((turn) => turn === 'failed').length;
  const cancelled = e.childTurns.filter((turn) => turn === 'cancelled').length;
  if (e.failed || failed || settled.some((task) => task.status === 'failed')) {
    return show('failed', failed && e.childTurns.length > 1 ? `${failed} of ${e.childTurns.length} failed` : undefined);
  }
  if (e.cancelled || cancelled || settled.some((task) => task.status === 'stopped')) return show('stopped');
  if (e.codex) {
    if (cutWithoutCompletion) return show(missing);
    if (e.tasks === null && e.parentRunning && e.answer) return show(null);
    if (e.answer || allDone) return show('completed');
  } else if (settled.length || (e.explicitForeground && e.answer && !e.background)) {
    return show('completed');
  }
  if (e.background && !e.tasksFresh) return show(null);
  if (e.answer || settled.length) return show(missing);
  return show(e.foregroundRunning && !e.parentCut ? 'running' : missing);
}

function latestSummary(tasks: readonly BackgroundTask[]): string {
  return (
    tasks
      .reduce<BackgroundTask | undefined>(
        (latest, task) => (!latest || task.startedAt >= latest.startedAt ? task : latest),
        undefined,
      )
      ?.summary?.trim() ?? ''
  );
}

export function describeAgent(facts: Facts, tasksFresh: boolean): AgentPresentation {
  const { call, state, tasks } = facts;
  const codex = isCodexAgent(call);
  const args = call.part.args as Record<string, unknown>;
  return presentAgent({
    codex,
    background: !codex && (args['run_in_background'] === true || Boolean(tasks?.length)),
    explicitForeground: args['run_in_background'] === false,
    needsPermission: needsYou(facts),
    cancelled: isCancelled(call),
    foregroundRunning: foregroundRunning(facts),
    parentRunning: isRunGoing(state),
    failed: isFailed(call),
    answer: answerOf(call),
    childAnswer: codex ? completedChildAnswer(call) : '',
    childTurns: codex ? agentTurns(call) : [],
    parentCut: codex && startedInCutTurn(call, facts.messages),
    tasks,
    tasksFresh,
  });
}

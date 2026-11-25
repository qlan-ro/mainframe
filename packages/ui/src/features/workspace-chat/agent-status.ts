/**
 * What a sub-agent's tab says of it. An ending is only claimed on positive
 * evidence: a task the daemon lists as ended, a result that is the agent's own,
 * or the end of the turn that would have answered. Null claims nothing.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { isErrorResult, resolveResultText } from '@/features/chat/tools/shared';
import { agentTurns, startedInCutTurn } from './agent-turns';
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

/** How Claude answers a call whose agent goes on in the background; it may do so without being asked to. */
const LAUNCH_RECEIPT = /^(Async agent launched|Spawned successfully)/;

export const isCodexAgent = (call: SubagentCall): boolean => call.part.toolName === CODEX_AGENT;

const isFailed = ({ part }: SubagentCall) => part.result !== undefined && isErrorResult(part.result, part.isError);

const answerOf = ({ part }: SubagentCall) =>
  part.result === undefined ? '' : resolveResultText(part.result).text.trim();

/** A Claude agent in the background. Its call is answered by a receipt, and only its task knows how it ended. */
function isInBackground(call: SubagentCall): boolean {
  if (isCodexAgent(call)) return false;
  const args = call.part.args as Record<string, unknown>;
  return args['run_in_background'] === true || LAUNCH_RECEIPT.test(answerOf(call));
}

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
function unanswered({ call, state, messages }: Facts): AgentStatus {
  if (isCancelled(call) || !isRunGoing(state)) return 'stopped';
  const at = messages.findIndex((message) => message.id === call.messageId);
  const spokenTo = messages.slice(at + 1).some((message) => message.role === 'user' && isDelivered(message));
  return spokenTo ? 'no-result' : 'running';
}

/** The agent outlives the call and the turn, so neither says that it ended. */
function unlistedInBackground(facts: Facts): AgentStatus | null {
  if (isFailed(facts.call)) return 'failed';
  if (isCancelled(facts.call)) return 'stopped';
  if (facts.tasks === null) return null;
  const launching = facts.call.part.result === undefined && isRunGoing(facts.state);
  return launching ? unanswered(facts) : 'no-result';
}

/** How a Claude agent that isn't running ended. */
function claudeEnd(facts: Facts): AgentStatus | null {
  const { call, tasks } = facts;
  const ends = new Set(tasks?.map((task) => task.status));
  if (ends.has('failed')) return 'failed';
  if (ends.has('stopped')) return 'stopped';
  if (ends.size === 0 && isInBackground(call)) return unlistedInBackground(facts);
  if (isFailed(call)) return 'failed';
  return ends.size > 0 || call.part.result !== undefined ? 'completed' : unanswered(facts);
}

/** How Codex agents ended, none of which runs. Their tasks end as completed however they did. */
function codexEnd(facts: Facts): AgentState | null {
  const { call, state, messages, tasks } = facts;
  if (call.part.result === undefined) return { status: tasks?.length ? 'no-result' : unanswered(facts) };
  const turns = agentTurns(call);
  // The call holds one result: the last agent's, whatever became of the others.
  const failed = turns.filter((turn) => turn === 'failed' || turn === 'cancelled').length;
  if (turns.length > 1 && failed > 0) return { status: 'failed', label: `${failed} of ${turns.length} failed` };
  if (isFailed(call)) return { status: 'failed' };
  // One has answered. Another may still be going.
  if (tasks === null && isRunGoing(state)) return null;
  // A turn that is cut short closes its agents as if they had answered; only their own turns know.
  const allDone = turns.every((turn) => turn === 'completed') && turns.length >= Math.max(1, tasks?.length ?? 0);
  return { status: startedInCutTurn(call, messages) && !allDone ? 'no-result' : 'completed' };
}

export function agentState(facts: Facts): AgentState | null {
  if (needsYou(facts)) return { status: 'needs-you' };
  const running = facts.tasks?.filter((task) => task.status === 'running').length ?? 0;
  if (running > 0) return { status: 'running', label: running > 1 ? `${running} running` : undefined };
  if (isCodexAgent(facts.call)) return codexEnd(facts);
  const status = claudeEnd(facts);
  return status && { status };
}

/** The agent's own result. Not a launch receipt, nor what stands in for an answer that never came. */
export function agentResult(call: SubagentCall, tasks: AgentTasks, state: AgentState | null): string {
  if (isCodexAgent(call)) return state === null || state.status === 'no-result' ? '' : answerOf(call);
  if (tasks?.some((task) => task.status === 'running')) return '';
  if (tasks?.length) return tasks.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b)).summary?.trim() ?? '';
  return isInBackground(call) && !isFailed(call) ? '' : answerOf(call);
}

/**
 * What an agent tab says of its call (W8). It repeats what the transcript and
 * the daemon's task list state, and is silent otherwise: there is no label for
 * an agent that finished.
 */
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { extractResultContent, isErrorResult, resolveResultText } from '@/features/chat/tools/shared';
import type { MainframeMessageMeta } from '@/features/chat/view-model/message-meta';
import type { AgentStatus } from './ConversationHeader';
import { toolCallIdsOf, type SubagentCall } from './find-subagent-call';

/** The tasks the daemon lists for a call, which can be several. Null until it has listed them. */
export type AgentTasks = readonly BackgroundTask[] | null;

/** Text that is not the call's own result, and where it is from. */
export interface AgentReport {
  source: 'Task summary' | 'Final answer';
  text: string;
}

interface Facts {
  call: SubagentCall;
  /** The parent chat. */
  state: ChatThreadState;
  tasks: AgentTasks;
}

interface AgentPresentation {
  status: { status: AgentStatus; label?: string } | null;
  /** The call's own text. */
  result: string;
  reports: AgentReport[];
  runningTask?: BackgroundTask;
}

export const isCodexAgent = (call: SubagentCall): boolean => call.part.toolName === 'CollabAgent';

const isFailed = ({ part }: SubagentCall) => part.result !== undefined && isErrorResult(part.result, part.isError);

/** Untouched, but for the CLI's tags around an error. */
function resultText(call: SubagentCall): string {
  const text = isFailed(call) ? '' : extractResultContent(call.part.result);
  return text || resolveResultText(call.part.result).text;
}

const lifecycleOf = ({ part }: SubagentCall) =>
  (part.providerMetadata?.mainframe as { acpStatus?: string } | undefined)?.acpStatus;

/** The call has no result and nothing says it ended, in a session that runs. */
function isOpen(call: SubagentCall, { runState }: ChatThreadState): boolean {
  const settled = ['completed', 'failed', 'cancelled'].includes(lifecycleOf(call) ?? '');
  const sessionRuns = runState.type === 'running' || runState.type === 'cancelling';
  return call.part.result === undefined && !settled && sessionRuns;
}

function needsYou(call: SubagentCall, state: ChatThreadState): boolean {
  const pending = new Set(Object.values(state.interactions.permissions).map((entry) => entry.request.toolUseId));
  return toolCallIdsOf(call.part.messages ?? []).some((id) => pending.has(id));
}

function statusOf({ call, state, tasks }: Facts, live: boolean): AgentPresentation['status'] {
  const listed = tasks ?? [];
  const count = (status: BackgroundTask['status']) => listed.filter((task) => task.status === status).length;
  const show = (status: AgentStatus, n = 1, several = n > 1) => ({
    status,
    label: several ? `${n} ${status}` : undefined,
  });

  if (needsYou(call, state)) return show('needs-you');
  const running = count('running');
  if (running > 0) return live ? show('running', running) : null;
  // A settled task speaks for its call, whatever the transcript still lacks.
  if (listed.length === 0 && isOpen(call, state)) return live ? show('running') : null;
  for (const status of ['failed', 'stopped'] as const) {
    const n = count(status);
    if (n > 0) return show(status, n, listed.length > 1);
  }
  if (isFailed(call)) return show('failed');
  return lifecycleOf(call) === 'cancelled' ? show('stopped') : null;
}

function taskSummaries(tasks: AgentTasks): AgentReport[] {
  return [...(tasks ?? [])]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((task) => ({ source: 'Task summary', text: task.summary?.trim() ?? '' }));
}

/** A Codex turn id is its thread's id and its own, in JSON. */
function threadOf(turnId: string): string {
  try {
    const parsed: unknown = JSON.parse(turnId);
    return Array.isArray(parsed) ? String(parsed[0]) : turnId;
  } catch {
    return turnId;
  }
}

/** The last final answer of each Codex agent under the call. */
function finalAnswers({ part }: SubagentCall): AgentReport[] {
  const byThread = new Map<string, string>();
  for (const message of part.messages ?? []) {
    const meta = message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;
    message.content.forEach((content, index) => {
      if (content.type !== 'text') return;
      for (const { presentation, startUtf16, endUtf16 } of meta?.partSources?.[index] ?? []) {
        const { parentToolUseId, phase, state, turnId } = presentation;
        if (parentToolUseId === part.toolCallId && phase === 'final_answer' && state === 'completed')
          byThread.set(threadOf(turnId), content.text.slice(startUtf16, endUtf16).trim());
      }
    });
  }
  return [...byThread.values()].map((text) => ({ source: 'Final answer', text }));
}

/** `live`: the list is the daemon's latest over a connection that still stands. */
export function describeAgent(facts: Facts, live: boolean): AgentPresentation {
  const { call, tasks } = facts;
  const result = resultText(call);
  const background = (call.part.args as Record<string, unknown>)['run_in_background'] === true;
  const reports = result.trim() === '' || background ? [...taskSummaries(tasks), ...finalAnswers(call)] : [];
  return {
    status: statusOf(facts, live),
    result,
    reports: reports.filter(({ text }) => text !== ''),
    runningTask: live ? tasks?.find((task) => task.status === 'running') : undefined,
  };
}

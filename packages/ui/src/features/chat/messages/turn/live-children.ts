/** Where a turn's child work stands right now: an agent, a delegated task or a workflow (T1e). Pure. */
import type { BackgroundActivityTask, BackgroundTask, TaskStatus } from '@qlan-ro/mainframe-types';
import { isTerminalTaskStatus } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { resumed, taskStatusOf } from '../../orchestration/task-standing';
import { findSession } from '../../orchestration/use-session-items';
import { partState } from '../../view-model/turn/build-turns';
import type { PartState, Turn, TurnChild, TurnModel } from '../../view-model/turn/types';

export type ChildState = 'needs-you' | 'running' | 'queued';

export interface LiveChildren {
  readonly byCall: ReadonlyMap<string, ChildState>;
  /** Call → when the background command or monitor it started began, while that still runs. */
  readonly background: ReadonlyMap<string, number>;
  /** Agents and delegated tasks whose call went through and whose work then failed. */
  readonly failed: ReadonlySet<string>;
  /** Background agents that were stopped or failed after their call had returned. */
  readonly ended: ReadonlyMap<string, 'stopped' | 'failed'>;
  /** A background agent is running and the daemon hasn't said yet which call started it. */
  readonly unplacedAgents: boolean;
}

export interface ChildSources {
  readonly sessions: readonly SessionItem[];
  readonly live: Readonly<Record<string, BackgroundActivityTask>>;
  readonly listed: readonly BackgroundTask[];
  /** Delegated task → the status of the result delivered for it. */
  readonly results?: ReadonlyMap<string, TaskStatus>;
}

function listedStatus(child: TurnChild, sources: ChildSources): TaskStatus | undefined {
  const status = child.taskChatId && findSession(sources.sessions, child.taskChatId)?.custom.delegation?.status;
  const delivered = child.taskId ? sources.results?.get(child.taskId) : undefined;
  return taskStatusOf({ delivered, listed: status || undefined, launched: child.taskStatus });
}

function delegatedState(child: TurnChild, chatId: string, sources: ChildSources): ChildState | undefined {
  const custom = findSession(sources.sessions, chatId)?.custom;
  if (custom?.hasPending || custom?.delegatedWaiting === true) return 'needs-you';
  const status = listedStatus(child, sources);
  // A launch whose chat nothing lists any more proves nothing about now.
  if (!status) return undefined;
  if (isTerminalTaskStatus(status)) return resumed(status, custom?.isRunning === true) ? 'running' : undefined;
  if (status === 'queued') return 'queued';
  return status === 'waiting' ? 'needs-you' : 'running';
}

const taskFailed = (child: TurnChild, sources: ChildSources): boolean =>
  child.taskChatId !== undefined && listedStatus(child, sources) === 'failed';

/**
 * A call that says it runs is believed only while its turn does, which `turnLive`
 * says (the turn settled the call's status too), or while the daemon holds a live
 * background task for it.
 */
export function childState(child: TurnChild, sources: ChildSources, turnLive: boolean): ChildState | undefined {
  if (child.status === 'awaiting-approval') return 'needs-you';
  if (child.taskChatId) return delegatedState(child, child.taskChatId, sources);
  if (child.status === 'running' && turnLive) return 'running';
  if (child.workflowTaskId) return sources.live[child.workflowTaskId] ? 'running' : undefined;
  const background = sources.listed.some(
    (task) => task.toolUseId === child.toolCallId && task.status === 'running' && sources.live[task.id],
  );
  return background ? 'running' : undefined;
}

export function liveChildren(model: TurnModel, given: Omit<ChildSources, 'results'>): LiveChildren {
  const sources: ChildSources = { ...given, results: model.taskResults };
  const byCall = new Map<string, ChildState>();
  const failed = new Set<string>();
  const ended = new Map<string, 'stopped' | 'failed'>();
  // A recovered task's status is a guess the daemon made when it started.
  for (const task of sources.listed)
    if (task.kind === 'agent' && !task.recovered && (task.status === 'stopped' || task.status === 'failed'))
      ended.set(task.toolUseId, task.status);
  for (const turn of model.turns.values())
    for (const child of turn.children) {
      const state = childState(child, sources, turn.live);
      const agentFailed = child.launched && ended.get(child.toolCallId) === 'failed';
      if (state) byCall.set(child.toolCallId, state);
      else if (agentFailed || taskFailed(child, sources)) failed.add(child.toolCallId);
    }
  const background = new Map<string, number>();
  for (const task of sources.listed)
    if (task.toolUseId && task.kind !== 'agent' && task.status === 'running' && sources.live[task.id])
      background.set(task.toolUseId, task.startedAt);
  const placed = new Set(sources.listed.map((task) => task.id));
  const unplacedAgents = Object.values(sources.live).some((task) => task.kind === 'agent' && !placed.has(task.id));
  return { byCall, background, failed, ended, unplacedAgents };
}

export const NO_CHILDREN: LiveChildren = {
  byCall: new Map(),
  background: new Map(),
  failed: new Set(),
  ended: new Map(),
  unplacedAgents: false,
};

export function sameLive(a: LiveChildren, b: LiveChildren): boolean {
  if (a.unplacedAgents !== b.unplacedAgents || a.byCall.size !== b.byCall.size) return false;
  if (a.background.size !== b.background.size || a.failed.size !== b.failed.size) return false;
  for (const id of a.failed) if (!b.failed.has(id)) return false;
  if (a.ended.size !== b.ended.size) return false;
  for (const [id, status] of a.ended) if (b.ended.get(id) !== status) return false;
  for (const [id, state] of a.byCall) if (b.byCall.get(id) !== state) return false;
  for (const [id, startedAt] of a.background) if (b.background.get(id) !== startedAt) return false;
  return true;
}

export function childGoing(child: TurnChild, live: LiveChildren): boolean {
  return live.byCall.has(child.toolCallId);
}

/** How a turn stands, its child work included (T1b, T1e). */
export function turnState(turn: Turn, live: LiveChildren): PartState {
  return partState(
    turn.evidence,
    turn.children.some((child) => childGoing(child, live)),
  );
}

/** "7 agents · 1 needs you · 1 running · 1 queued", as its parts. */
export interface ChildCounts {
  readonly who: string;
  readonly needsYou: number;
  readonly running: number;
  readonly queued: number;
}

const plural = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');

export function childCounts(children: readonly TurnChild[], live: LiveChildren): ChildCounts | undefined {
  if (!children.length) return undefined;
  const agents = children.filter((child) => child.kind === 'agent').length;
  const states = children.map((child) => live.byCall.get(child.toolCallId));
  const count = (state: ChildState) => states.filter((value) => value === state).length;
  return {
    who: [plural(agents, 'agent'), plural(children.length - agents, 'workflow')].filter(Boolean).join(', '),
    needsYou: count('needs-you'),
    running: count('running'),
    queued: count('queued'),
  };
}

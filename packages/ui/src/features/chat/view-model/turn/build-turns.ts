/**
 * Messages → turns. Structural, so it holds for every adapter and for history:
 * a turn is the assistant messages between two user messages, also split where
 * the provider started another turn on its own (a task result came back). The
 * provider's metadata adds only what structure can't: how the turn ended and
 * how long it ran.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { isPlaceholder } from '../placeholder';
import { verifiedTurnTiming, turnDuration } from './turn-timing';
import { answerUnits, failedSteps, nestedPending, turnChildren, workTools } from './turn-roles';
import { turnSummary } from './turn-summary';
import { TurnCache } from './turn-cache';
import { settledStatus } from './tool-status';
import { isMarkerUnit, messageMeta } from './turn-units';
import { absorbedTaskResults, taskResultStatuses } from './task-results';
import { SkillMatcher } from './skill-matcher';
import { isChildWork } from './tool-kind';
import type { MessageSlice, ToolPart, Turn, TurnEnd, TurnModel, TurnScope, TurnUnit } from './types';

interface Draft {
  readonly key: string;
  readonly messages: ThreadMessage[];
  readonly units: (readonly TurnUnit[])[];
  providerTurn?: string;
  failed: boolean;
}

function providerTurnOf(units: readonly TurnUnit[]): string | undefined {
  for (const { presentation } of units) if (presentation) return `${presentation.provider}:${presentation.turnId}`;
  return undefined;
}

/**
 * Whether a user message ends the turn before it. A queued prompt waits for the
 * turn to end; a send that failed reached nobody; and one the daemon has not
 * confirmed yet, sent while the turn ran, has not ended it either. Only a turn
 * the last build saw ended is over.
 */
function endsTurn(message: ThreadMessage, open: Draft | undefined, scope: TurnScope, cache: TurnCache): boolean {
  const meta = messageMeta(message);
  if (meta?.queued === true || meta?.error !== undefined) return false;
  return !(meta?.pending === true && scope.isRunning === true && open && cache.wentOn(open.key) !== false);
}

/** Groups the messages into turns, and collects what another element stands for. */
function draftTurns(messages: readonly ThreadMessage[], scope: TurnScope, cache: TurnCache) {
  const drafts: Draft[] = [];
  const skills = new SkillMatcher();
  let open: Draft | undefined;
  for (const message of messages) {
    if (isPlaceholder(message)) continue;
    if (message.role === 'user') {
      if (endsTurn(message, open, scope, cache)) open = undefined;
      continue;
    }
    if (message.role === 'system') {
      const meta = messageMeta(message);
      if (meta?.providerSwitch) open = undefined;
      else if (meta?.skillLoaded) skills.claim(message.id, meta.skillLoaded, open?.units.flat() ?? []);
      continue;
    }
    if (messageMeta(message)?.errorText !== undefined) {
      if (open) open.failed = true; // drawn on its own, as the error it is
      continue;
    }
    const units = cache.units(message, scope);
    const providerTurn = providerTurnOf(units);
    if (open?.providerTurn && providerTurn && open.providerTurn !== providerTurn) open = undefined;
    if (!open) {
      const key = JSON.stringify([scope.rootThreadId, scope.ancestors, message.id]);
      open = { key, messages: [], units: [], failed: false };
      drafts.push(open);
    }
    open.providerTurn ??= providerTurn;
    open.messages.push(message);
    open.units.push(units);
  }
  return { drafts, last: open, skills };
}

interface Standing {
  readonly running: boolean;
  readonly live: boolean;
  readonly needsYou: boolean;
}

/** The thread's pending requests a draft holds: on its own steps, and inside the agents it started. */
function pendingIn(draft: Draft, pending: ReadonlySet<string>): { own: Set<string>; nested: boolean } {
  const own = new Set<string>();
  let nested = false;
  if (!pending.size) return { own, nested };
  for (const { part } of draft.units.flat()) {
    if (part.type !== 'tool-call') continue;
    if (pending.has(part.toolCallId)) own.add(part.toolCallId);
    else if (nestedPending(part, pending)) nested = true;
  }
  return { own, nested };
}

/**
 * The newest turn, with the viewer's message after it and nothing of the agent's
 * yet. The provider says when a turn ended; whether it goes on it says too (Codex),
 * or not while the viewer writes into it (Claude): then it goes on if it did just now.
 */
function goesOn(draft: Draft, cache: TurnCache): boolean {
  const states = new Set(draft.units.flat().map((unit) => unit.presentation?.state));
  if (states.has('completed') || states.has('cancelled') || states.has('failed')) return false;
  return cache.wentOn(draft.key) ?? states.has('running');
}

/**
 * How each turn stands. A thread that waits on the viewer reports itself idle,
 * so a turn that holds the request is told by the request; one whose call has
 * not arrived yet belongs to the turn that runs. A background agent's request
 * (`nested`, in an earlier turn) only holds its turn open, as child work.
 */
function standings(
  drafts: readonly Draft[],
  last: Draft | undefined,
  scope: TurnScope,
  cache: TurnCache,
): Map<Draft, Standing> {
  const held = new Map(drafts.map((draft) => [draft, pendingIn(draft, scope.pendingToolIds)]));
  const placed = [...held.values()].some(({ own, nested }) => own.size > 0 || nested);
  const newest = drafts[drafts.length - 1];
  const running = scope.isRunning === true;
  return new Map(
    drafts.map((draft) => {
      const { own, nested } = held.get(draft)!;
      const unplaced = running && draft === last && scope.pendingToolIds.size > 0 && !placed;
      const needsYou = own.size > 0 || unplaced || (draft === last && nested);
      const isRunning = needsYou || (running && draft === last);
      // The viewer can write into a turn that goes on: its calls outlive the split.
      const steered = last
        ? draft.providerTurn !== undefined && draft.providerTurn === last.providerTurn
        : draft === newest && goesOn(draft, cache);
      return [draft, { running: isRunning, needsYou, live: isRunning || (running && steered) }];
    }),
  );
}

function endOf(draft: Draft, units: readonly TurnUnit[], scope: TurnScope, live: boolean): TurnEnd {
  const states = new Set(units.map((unit) => unit.presentation?.state));
  if (draft.failed || states.has('failed')) return 'error';
  const status = draft.messages[draft.messages.length - 1]!.status;
  if (status?.type === 'incomplete' && status.reason === 'error') return 'error';
  if (states.has('cancelled') || (status?.type === 'incomplete' && status.reason === 'cancelled')) return 'stopped';
  const steps = units.filter((unit) => !isMarkerUnit(unit));
  const last = steps[steps.length - 1]?.part;
  const cutShort = last?.type === 'tool-call' && settledStatus(last, scope.pendingToolIds, live) === 'stopped';
  return cutShort ? 'stopped' : 'done';
}

function durationOf(draft: Draft, units: readonly TurnUnit[], now: number): number | undefined {
  const provider = turnDuration(verifiedTurnTiming(units, now), false, now);
  if (provider !== undefined) return provider;
  const streamed = draft.messages.flatMap((message) => message.metadata?.timing?.totalStreamTime ?? []);
  return streamed.length ? streamed.reduce((sum, ms) => sum + ms, 0) : undefined;
}

/** What the provider charged, wherever in the turn it said so. */
function costOf(draft: Draft): number | undefined {
  const costs = draft.messages.flatMap((message) => messageMeta(message)?.cost ?? []);
  return costs.length ? costs.reduce((sum, usd) => sum + usd, 0) : undefined;
}

const stillRuns = (tools: readonly ToolPart[], scope: TurnScope): boolean =>
  tools.some((tool) => !isChildWork(tool.toolName) && settledStatus(tool, scope.pendingToolIds, true) === 'running');

function turnOf(draft: Draft, { running, live, needsYou }: Standing, scope: TurnScope, now: number): Turn {
  const units = draft.units.flat();
  const answer = answerUnits(units, running);
  const work = units.filter((unit) => !isMarkerUnit(unit) && !answer.has(unit));
  const tools = workTools(work);
  return {
    key: draft.key,
    running,
    live,
    unfinished: live && !running && stillRuns(tools, scope),
    needsYou,
    end: endOf(draft, units, scope, live),
    durationMs: running ? undefined : durationOf(draft, units, now),
    costUsd: costOf(draft),
    lastMessageId: draft.messages[draft.messages.length - 1]!.id,
    summary: turnSummary(tools, work.filter((unit) => unit.part.type === 'image').length),
    hasWork: work.length > 0,
    ...failedSteps(tools, scope.pendingToolIds, live),
    children: turnChildren(tools, scope.pendingToolIds, live),
    workKeys: work.map((unit) => unit.key),
  };
}

function slicesOf(draft: Draft, running: boolean): MessageSlice[] {
  const answer = answerUnits(draft.units.flat(), running);
  const parts = draft.messages.map((message, index) => {
    const units = draft.units[index]!;
    return {
      messageId: message.id,
      work: units.filter((unit) => !isMarkerUnit(unit) && !answer.has(unit)),
      markers: units.filter(isMarkerUnit),
      answer: units.filter((unit) => answer.has(unit)),
    };
  });
  const header = parts.findIndex((part) => part.work.length > 0);
  let footer = parts.length - 1;
  while (footer >= 0 && !parts[footer]!.answer.length) footer--;
  return parts.map((part, index) => ({
    ...part,
    turnKey: draft.key,
    header: index === header,
    footer: index === (footer < 0 ? parts.length - 1 : footer),
  }));
}

/** What the next build is told of a turn: it went on, it had ended, or nobody could say. */
function wentOn(live: boolean, isLast: boolean, scope: TurnScope, before: boolean | undefined): boolean | undefined {
  if (live) return true;
  return scope.isRunning === true || isLast || before !== undefined ? false : undefined;
}

export function buildTurns(
  messages: readonly ThreadMessage[],
  scope: TurnScope,
  cache = new TurnCache(),
  now = Date.now(),
): TurnModel {
  cache.begin(scope);
  const { drafts, last, skills } = draftTurns(messages, scope, cache);
  const turns = new Map<string, Turn>();
  const slices = new Map<string, MessageSlice>();
  const standing = standings(drafts, last, scope, cache);
  for (const draft of drafts) {
    const stand = standing.get(draft)!;
    const state = JSON.stringify([stand, draft.failed]);
    const built = cache.turn(draft.key, draft.messages, draft.units, state, () => ({
      turn: turnOf(draft, stand, scope, now),
      slices: slicesOf(draft, stand.running),
    }));
    turns.set(draft.key, built.turn);
    for (const slice of built.slices) slices.set(slice.messageId, slice);
  }
  cache.finish(
    drafts.map((draft) => {
      const { live } = standing.get(draft)!;
      return [draft.key, wentOn(live, draft === last, scope, cache.wentOn(draft.key))] as const;
    }),
  );
  const absorbedBy = new Map([...skills.absorbedBy, ...absorbedTaskResults(messages)]);
  return {
    turns,
    slices,
    absorbed: new Set(absorbedBy.keys()),
    absorbedBy,
    taskResults: taskResultStatuses(messages),
    skills: skills.byCall,
    runningKey: last && standing.get(last)!.running ? last.key : undefined,
  };
}

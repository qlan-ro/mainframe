/**
 * Messages → turns, and the one rule for how a part of a turn stands. Going is
 * read from the session; how a part ended only from its own messages (`endOf`),
 * so no part can be given another's end.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { verifiedTurnTiming, turnDuration } from './turn-timing';
import { answerUnits, failedSteps, hasUnknownStep, nestedPending, turnChildren, workTools } from './turn-roles';
import { turnSummary } from './turn-summary';
import { TurnCache } from './turn-cache';
import { draftTurns, type Draft, type Drafts } from './turn-drafts';
import { endOf, isOpenStep } from './turn-end';
import type { MainframeMessageMeta } from '../message-meta';
import { isMarkerUnit, messageMeta } from './turn-units';
import { absorbedTaskResults, taskResultStatuses } from './task-results';
import type { MessageSlice, PartEvidence, PartState, Turn, TurnModel, TurnScope, TurnUnit } from './types';

/**
 * How a part stands, from the first of these its evidence holds for. `liveChild`:
 * an agent, task or workflow it started is known to go on, which the daemon and
 * the child's own chat say and the messages don't.
 */
export function partState({ needsYou, live, ended }: PartEvidence, liveChild: boolean): PartState {
  if (needsYou) return 'needs-you';
  return live || liveChild ? 'going' : (ended ?? 'neutral');
}

const isOnItsWay = (meta: MainframeMessageMeta | undefined) => meta?.pending === true && meta.error === undefined;

interface Standing {
  readonly needsYou: boolean;
  /** The agent writes in it, or waits on the viewer in it. */
  readonly running: boolean;
  /** It belongs to the run in progress. */
  readonly inRun: boolean;
  readonly session: boolean;
}

/** The thread's pending requests a draft holds: on its own steps, and inside the agents it started. */
function pendingIn(draft: Draft, pending: ReadonlySet<string>): { own: boolean; nested: boolean } {
  let own = false;
  let nested = false;
  if (!pending.size) return { own, nested };
  for (const { part } of draft.units.flat()) {
    if (part.type !== 'tool-call') continue;
    if (pending.has(part.toolCallId)) own = true;
    else if (nestedPending(part, pending)) nested = true;
  }
  return { own, nested };
}

/**
 * A request belongs to the part that holds its call; one whose call has not
 * arrived yet, to the part that runs. A background agent's request, in an
 * earlier part, only holds that part open, as child work.
 */
function standings(
  { drafts, last }: Drafts,
  messages: readonly ThreadMessage[],
  { pendingToolIds, isRunning: session = false, runAfter }: TurnScope,
): Map<Draft, Standing> {
  const held = new Map(drafts.map((draft) => [draft, pendingIn(draft, pendingToolIds)]));
  const unplaced = pendingToolIds.size > 0 && ![...held.values()].some(({ own, nested }) => own || nested);
  const start = typeof runAfter === 'string' ? messages.findIndex(({ id }) => id === runAfter) : -1;
  const seen = start >= 0 || runAfter === null;
  // The run a prompt on its way began holds nothing yet: the turn above it stays as it ended.
  const begun = seen && messages.some((message) => isOnItsWay(messageMeta(message)));
  return new Map(
    drafts.map((draft) => {
      const { own, nested } = held.get(draft)!;
      const isLast = draft === last;
      const needsYou = own || (isLast && (nested || (unplaced && session)));
      const inRun = session && ((isLast && !begun) || (seen && draft.index > start));
      return [draft, { needsYou, running: needsYou || (isLast && inRun), inRun, session }];
    }),
  );
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

function turnOf(draft: Draft, standing: Standing, scope: TurnScope, now: number): Turn {
  const { running, needsYou, inRun, session } = standing;
  const units = draft.units.flat();
  const answer = answerUnits(units, running);
  const work = units.filter((unit) => !isMarkerUnit(unit) && !answer.has(unit));
  const tools = workTools(work);
  const liveStep =
    session && work.some((unit) => unit.presentation?.state === 'running' && isOpenStep(unit, scope.pendingToolIds));
  const live = needsYou || inRun || liveStep;
  const ended = endOf(draft, scope);
  return {
    key: draft.key,
    running,
    needsYou,
    live,
    ...(ended && { ended }),
    unclear: hasUnknownStep(work, scope.pendingToolIds, live),
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

export function buildTurns(
  messages: readonly ThreadMessage[],
  scope: TurnScope,
  cache = new TurnCache(),
  now = Date.now(),
): TurnModel {
  cache.begin(scope);
  const drafted = draftTurns(messages, scope, cache);
  const { drafts, last, skills } = drafted;
  const turns = new Map<string, Turn>();
  const slices = new Map<string, MessageSlice>();
  const standing = standings(drafted, messages, scope);
  for (const draft of drafts) {
    const stand = standing.get(draft)!;
    const state = JSON.stringify([stand, draft.error > draft.said]);
    const built = cache.turn(draft.key, draft.messages, draft.units, state, () => ({
      turn: turnOf(draft, stand, scope, now),
      slices: slicesOf(draft, stand.running),
    }));
    turns.set(draft.key, built.turn);
    for (const slice of built.slices) slices.set(slice.messageId, slice);
  }
  cache.finish();
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

/**
 * Messages → turns, and the one rule for how a part of a turn stands.
 *
 * Where the viewer writes into a run splits the transcript, not the run, so a
 * part's state never follows from what comes after it: it is read from what the
 * session, the provider and its own steps say (`partState`).
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { verifiedTurnTiming, turnDuration } from './turn-timing';
import { answerUnits, failedSteps, nestedPending, turnChildren, workTools } from './turn-roles';
import { turnSummary } from './turn-summary';
import { TurnCache } from './turn-cache';
import { draftTurns, type Draft } from './turn-drafts';
import { draftRuns, type DraftRun } from './turn-runs';
import { resolveToolStatus } from './tool-status';
import { isMarkerUnit, messageMeta } from './turn-units';
import { absorbedTaskResults, taskResultStatuses } from './task-results';
import type { MessageSlice, PartEvidence, PartState, Turn, TurnModel, TurnScope, TurnUnit } from './types';

/**
 * How a part stands, from the first of these its evidence holds for. `liveChild`:
 * an agent, task or workflow it started is known to go on, which the daemon and
 * the child's own chat say and the messages don't.
 */
export function partState(evidence: PartEvidence, liveChild: boolean): PartState {
  const { needsYou, run, unsettled, ended } = evidence;
  if (needsYou) return 'needs-you';
  if (liveChild || run === 'current' || (run === 'unknown' && unsettled)) return 'going';
  if (ended === 'error') return 'error';
  if (ended === 'cancelled' || unsettled) return 'stopped';
  return ended === 'completed' ? 'finished' : 'neutral';
}

interface Standing extends DraftRun {
  readonly needsYou: boolean;
  readonly running: boolean;
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
  drafts: readonly Draft[],
  last: Draft | undefined,
  runs: ReadonlyMap<Draft, DraftRun>,
  scope: TurnScope,
): Map<Draft, Standing> {
  const held = new Map(drafts.map((draft) => [draft, pendingIn(draft, scope.pendingToolIds)]));
  const unplaced = scope.pendingToolIds.size > 0 && ![...held.values()].some(({ own, nested }) => own || nested);
  return new Map(
    drafts.map((draft) => {
      const { own, nested } = held.get(draft)!;
      const run = runs.get(draft)!;
      const needsYou = own || (draft === last && (nested || (unplaced && run.run === 'current')));
      return [draft, { ...run, needsYou, running: needsYou || (draft === last && run.run === 'current') }];
    }),
  );
}

/** How the turn itself ended: what was said of the whole turn, before what its last message shows. */
function endedAs(draft: Draft, units: readonly TurnUnit[], { reason, errorLast }: Standing): PartEvidence['ended'] {
  const states = new Set(units.map((unit) => unit.presentation?.state));
  const status = (draft.lastVisible ?? draft.messages[draft.messages.length - 1]!).status;
  const cut = status?.type === 'incomplete' ? status.reason : undefined;
  if (states.has('failed') || reason === '_mainframe.dev/error') return 'error';
  if (states.has('cancelled') || reason === 'cancelled' || cut === 'cancelled') return 'cancelled';
  if (errorLast || cut === 'error') return 'error';
  return states.has('completed') || reason === 'end_turn' ? 'completed' : undefined;
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
  const { running, needsYou, run } = standing;
  const units = draft.units.flat();
  const answer = answerUnits(units, running);
  const work = units.filter((unit) => !isMarkerUnit(unit) && !answer.has(unit));
  const tools = workTools(work);
  const live = needsYou || run !== 'over';
  const statuses = tools.map((tool) => resolveToolStatus(tool, scope.pendingToolIds));
  const unsettled = statuses.some((status) => status === 'running' || status === 'awaiting-approval');
  const ended = endedAs(draft, units, standing);
  return {
    key: draft.key,
    running,
    live,
    evidence: { needsYou, run, unsettled, ...(ended && { ended }) },
    unclear: statuses.includes('unknown'),
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
  const standing = standings(drafts, last, draftRuns(drafted, messages, scope), scope);
  for (const draft of drafts) {
    const stand = standing.get(draft)!;
    const built = cache.turn(draft.key, draft.messages, draft.units, JSON.stringify(stand), () => ({
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

/** Which run a draft belongs to, and what is known of that run. Pure. */
import type { ThreadMessage } from '@assistant-ui/react';
import type { StopReason } from '@qlan-ro/mainframe-types';
import type { RunRecord, TranscriptMark } from '../../controller/run-records';
import { lastParts, type Draft, type Drafts } from './turn-drafts';
import type { PartEvidence, TurnScope } from './types';

export interface DraftRun {
  readonly run: PartEvidence['run'];
  /** How the daemon said its run ended. */
  readonly reason?: StopReason;
  /** Nothing the agent said in its run follows its last error. */
  readonly errorLast: boolean;
}

const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

const TERMINAL: ReadonlySet<string | undefined> = new Set(['completed', 'cancelled', 'failed']);

/** The provider ended the turn the draft's last words belong to. Parts it says nothing of end nothing. */
function providerOver(draft: Draft): boolean {
  return TERMINAL.has(lastOf(draft.units.flat())?.presentation?.state);
}

/** Where a mark is in the loaded messages; a run whose marks aren't loaded tells nothing. */
interface Span {
  readonly after: readonly [number, number];
  readonly until?: readonly [number, number];
  readonly record: RunRecord;
}
const BEFORE_ALL = [-1, 0] as const;

function spans(runs: readonly RunRecord[], messages: readonly ThreadMessage[]): readonly Span[] {
  if (!runs.length) return [];
  const wanted = new Set(runs.flatMap(({ after, end }) => [after?.id, end?.until?.id]));
  const places = new Map<string, number>();
  for (const [index, { id }] of messages.entries()) if (wanted.has(id)) places.set(id, index);
  const place = (mark: TranscriptMark | null) => {
    if (!mark) return BEFORE_ALL;
    const index = places.get(mark.id);
    return index === undefined ? undefined : ([index, mark.parts] as const);
  };
  return runs.flatMap((record) => {
    const after = place(record.after);
    const until = record.end && place(record.end.until);
    return after && (until || !record.end) ? [{ after, record, ...(until && { until }) }] : [];
  });
}

/** Whether the draft reaches past a place: in a later message, or in parts its message has gained since. */
const past = (draft: Draft, [index, parts]: readonly [number, number]): boolean =>
  (draft.said < 0 ? draft.index : draft.said) > index || (draft.said === index && lastParts(draft) > parts);

/** Each draft's run: the last one it reaches into, unless it also reaches past that one's end. Both are in order. */
function spanOfDrafts(drafts: readonly Draft[], known: readonly Span[]): ReadonlyMap<Draft, number> {
  const spanOf = new Map<Draft, number>();
  let at = -1;
  for (const draft of drafts) {
    while (known[at + 1] && past(draft, known[at + 1]!.after)) at++;
    const span = known[at];
    if (span && (!span.until || !past(draft, span.until))) spanOf.set(draft, at);
  }
  return spanOf;
}

/** The runs whose last error nothing the agent said follows. */
function errorRuns(
  { drafts, errors }: Drafts,
  known: readonly Span[],
  spanOf: ReadonlyMap<Draft, number>,
): ReadonlySet<number> {
  if (!errors.length) return new Set();
  const said = new Map<number, number>();
  for (const draft of drafts) {
    const at = spanOf.get(draft);
    if (at !== undefined) said.set(at, Math.max(said.get(at) ?? -1, draft.said));
  }
  return new Set(
    [...said].flatMap(([at, last]) => {
      // An error can still arrive just after the run's end: it is the run's until the next one begins.
      const next = known[at + 1];
      const from = Math.max(last, known[at]!.after[0]);
      const own = errors.some((index) => index > from && (!next || index <= next.after[0]));
      return own ? [at] : [];
    }),
  );
}

export function draftRuns(
  drafted: Drafts,
  messages: readonly ThreadMessage[],
  { isRunning, runs = [] }: TurnScope,
): ReadonlyMap<Draft, DraftRun> {
  const { drafts, sent } = drafted;
  const known = spans(runs, messages);
  const open = lastOf(known.filter(({ record }) => !record.end));
  const running = open ?? { after: [sent, Infinity] as const, record: undefined };
  const seenIdle = lastOf(known.filter(({ until }) => until))?.until;
  const spanOf = spanOfDrafts(drafts, known);
  const endedByMessage = new Map<string, RunRecord>();
  for (const record of runs) {
    for (const id of record.end?.messageIds ?? []) endedByMessage.set(id, record);
  }
  const errored = errorRuns(drafted, known, spanOf);
  const runOf = (draft: Draft): PartEvidence['run'] => {
    if (isRunning !== true || providerOver(draft)) return 'over';
    if (past(draft, running.after)) return 'current';
    return running.record?.exact || (seenIdle && !past(draft, seenIdle)) ? 'over' : 'unknown';
  };
  return new Map(
    drafts.map((draft) => {
      const at = spanOf.get(draft);
      const id = draft.lastVisible?.id;
      const match = id === undefined ? undefined : endedByMessage.get(id);
      const end = match?.end;
      const recorded =
        end && (!end.until || id !== end.until.id || lastParts(draft) <= end.until.parts) ? end : undefined;
      const reason = recorded?.reason ?? (at === undefined ? undefined : known[at]!.record.end?.reason);
      const errorLast = at === undefined ? draft.error > draft.said : errored.has(at);
      return [draft, { run: recorded ? 'over' : runOf(draft), errorLast, ...(reason && { reason }) }];
    }),
  );
}

/** How a part ended, from its own messages alone: they say the same whenever and however much of the rest is loaded. Pure. */
import type { Draft } from './turn-drafts';
import { resolveToolStatus } from './tool-status';
import type { PartEnd, TurnScope, TurnUnit } from './types';

type State = NonNullable<TurnUnit['presentation']>['state'];

const CUT: ReadonlySet<State> = new Set(['cancelled', 'failed', 'invalid']);

export const isOpenStep = ({ part }: TurnUnit, pending: ReadonlySet<string>): boolean =>
  part.type === 'tool-call' && ['running', 'awaiting-approval'].includes(resolveToolStatus(part, pending));

/** Each provider turn in the part, in order: its latest state, and whether a step of it has no outcome. */
function providerTurns(units: readonly TurnUnit[], pending: ReadonlySet<string>) {
  const turns = new Map<string, { state: State; open: boolean }>();
  for (const unit of units) {
    if (!unit.presentation) continue;
    const { turnId, state } = unit.presentation;
    turns.set(turnId, { state, open: Boolean(turns.get(turnId)?.open) || isOpenStep(unit, pending) });
  }
  return [...turns.values()];
}

export function endOf(draft: Draft, { pendingToolIds }: TurnScope): PartEnd | undefined {
  const last = draft.lastVisible ?? draft.messages[draft.messages.length - 1]!;
  const cut = last.status?.type === 'incomplete' ? last.status.reason : undefined;
  // Words the provider has not placed are no part of the turn it ended.
  const placed = draft.units[draft.messages.indexOf(last)]!.some(({ presentation }) => presentation);
  const turns = placed ? providerTurns(draft.units.flat(), pendingToolIds) : [];
  const state = turns[turns.length - 1]?.state;
  if (state === 'failed') return 'error';
  if (state === 'cancelled' || cut === 'cancelled') return 'stopped';
  if (cut === 'error' || draft.error > draft.said) return 'error';
  const whole = turns.every((turn) => turn.state === 'completed' || (!CUT.has(turn.state) && !turn.open));
  return state === 'completed' && whole ? 'finished' : undefined;
}

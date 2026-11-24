/**
 * Identity across rebuilds. The model is rebuilt on every streamed chunk;
 * messages, turns and slices a chunk did not touch keep their objects, so the
 * rows that read them do not re-render.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { messageUnits } from './turn-units';
import type { MessageSlice, Turn, TurnScope, TurnUnit } from './types';

const same = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value, i) => value === b[i]);

function sameSlice(a: MessageSlice, b: MessageSlice): boolean {
  return (
    a.header === b.header &&
    a.footer === b.footer &&
    same(a.work, b.work) &&
    same(a.markers, b.markers) &&
    same(a.answer, b.answer)
  );
}

function sameTurn(a: Turn, b: Turn): boolean {
  return (
    a.running === b.running &&
    a.end === b.end &&
    a.durationMs === b.durationMs &&
    a.summary === b.summary &&
    a.hasWork === b.hasWork &&
    same(a.failed, b.failed) &&
    same(a.retried, b.retried) &&
    same(a.workKeys, b.workKeys) &&
    a.children.length === b.children.length &&
    a.children.every((child, i) => {
      const other = b.children[i]!;
      return (
        child.toolCallId === other.toolCallId &&
        child.status === other.status &&
        child.taskChatId === other.taskChatId &&
        child.workflowTaskId === other.workflowTaskId
      );
    })
  );
}

interface Built {
  readonly turn: Turn;
  readonly slices: readonly MessageSlice[];
}
interface CachedTurn extends Built {
  readonly messages: readonly ThreadMessage[];
  readonly units: readonly (readonly TurnUnit[])[];
  /** Whatever else the turn is built from. */
  readonly state: string;
}
interface CachedUnits {
  readonly message: ThreadMessage;
  readonly units: readonly TurnUnit[];
}

export class TurnCache {
  private scope = '';
  private messages = new Map<string, CachedUnits>();
  private turns = new Map<string, CachedTurn>();
  private seenMessages = new Set<string>();
  private seenTurns = new Set<string>();

  begin(scope: TurnScope): void {
    const key = JSON.stringify([scope.rootThreadId, scope.ancestors, [...scope.pendingToolIds].sort()]);
    if (key !== this.scope) {
      this.messages.clear();
      this.turns.clear();
      this.scope = key;
    }
    this.seenMessages.clear();
    this.seenTurns.clear();
  }

  units(message: ThreadMessage, scope: TurnScope): readonly TurnUnit[] {
    this.seenMessages.add(message.id);
    const previous = this.messages.get(message.id);
    if (
      previous &&
      previous.message.content === message.content &&
      previous.message.status === message.status &&
      previous.message.metadata === message.metadata
    )
      return previous.units;
    const units = this.reuse(previous?.units ?? [], messageUnits(message, scope));
    this.messages.set(message.id, { message, units });
    return units;
  }

  /** A part that kept its object keeps its unit: only the growing one is new. */
  private reuse(before: readonly TurnUnit[], after: readonly TurnUnit[]): readonly TurnUnit[] {
    const known = new Map(before.map((unit) => [unit.key, unit]));
    return after.map((unit) => {
      const prior = known.get(unit.key);
      return prior && prior.index === unit.index && samePart(prior, unit) ? prior : unit;
    });
  }

  turn(
    key: string,
    messages: readonly ThreadMessage[],
    units: readonly (readonly TurnUnit[])[],
    state: string,
    build: () => Built,
  ): Built {
    this.seenTurns.add(key);
    const previous = this.turns.get(key);
    if (previous && previous.state === state && same(previous.messages, messages) && same(previous.units, units))
      return previous;
    const next = build();
    const slices = new Map(previous?.slices.map((slice) => [slice.messageId, slice]));
    const kept = {
      turn: previous && sameTurn(previous.turn, next.turn) ? previous.turn : next.turn,
      slices: next.slices.map((slice) => {
        const prior = slices.get(slice.messageId);
        return prior && sameSlice(prior, slice) ? prior : slice;
      }),
    };
    this.turns.set(key, { ...kept, messages, units, state });
    return kept;
  }

  finish(): void {
    for (const key of this.messages.keys()) if (!this.seenMessages.has(key)) this.messages.delete(key);
    for (const key of this.turns.keys()) if (!this.seenTurns.has(key)) this.turns.delete(key);
  }
}

/** `messageUnits` copies each part to stamp its status, so compare what the part is made of. */
function samePart(a: TurnUnit, b: TurnUnit): boolean {
  if (a.presentation?.state !== b.presentation?.state || a.part.status?.type !== b.part.status?.type) return false;
  const left = a.part as unknown as Record<string, unknown>;
  const right = b.part as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  keys.delete('status');
  return [...keys].every((key) => left[key] === right[key]);
}

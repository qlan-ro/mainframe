import type { ThreadMessage } from '@assistant-ui/react';
import { messageSourceUnits } from './turn-source-units';
import type { DisplayUnit, MessagePresentation, SourceUnit, TurnDisclosure, TurnScope } from './turn-types';

const sameMembers = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
function sameTurn(a: TurnDisclosure, b: TurnDisclosure): boolean {
  return (
    a.available === b.available &&
    a.unsafe === b.unsafe &&
    a.invalid === b.invalid &&
    a.activeAgent === b.activeAgent &&
    a.running === b.running &&
    a.firstWorkKey === b.firstWorkKey &&
    sameMembers(a.workKeys, b.workKeys) &&
    sameMembers(a.innerKeys, b.innerKeys) &&
    a.timing?.startedAtMs === b.timing?.startedAtMs &&
    a.timing?.completedAtMs === b.timing?.completedAtMs &&
    a.timing?.durationMs === b.timing?.durationMs
  );
}
function sameMessage(a: MessagePresentation, b: MessagePresentation): boolean {
  return (
    a.native === b.native &&
    a.footerInDetails === b.footerInDetails &&
    a.timingTurnKey === b.timingTurnKey &&
    sameMembers(a.units, b.units)
  );
}
function prune<T>(map: Map<string, T>, visited: ReadonlySet<string>) {
  for (const key of map.keys()) if (!visited.has(key)) map.delete(key);
}
type Sources = { message: ThreadMessage; units: readonly SourceUnit[] };
type Group = { members: readonly SourceUnit[]; open: boolean; units: readonly DisplayUnit[] };
export class TurnPresentationCache {
  private scope = '';
  private sources = new Map<string, Sources>();
  private groups = new Map<string, Group>();
  private turns = new Map<string, TurnDisclosure>();
  private messages = new Map<string, MessagePresentation>();
  private seen = {
    sources: new Set<string>(),
    groups: new Set<string>(),
    turns: new Set<string>(),
    messages: new Set<string>(),
  };

  begin(scope: TurnScope) {
    const key = JSON.stringify([scope.rootThreadId, scope.ancestors, [...scope.pendingToolIds].sort()]);
    if (key !== this.scope) {
      this.sources.clear();
      this.groups.clear();
      this.turns.clear();
      this.messages.clear();
      this.scope = key;
    }
    Object.values(this.seen).forEach((set) => set.clear());
  }
  sourceUnits(message: ThreadMessage, scope: TurnScope): readonly SourceUnit[] {
    this.seen.sources.add(message.id);
    const previous = this.sources.get(message.id);
    if (
      previous &&
      previous.message.content === message.content &&
      previous.message.status === message.status &&
      previous.message.metadata === message.metadata
    )
      return previous.units;
    const units = messageSourceUnits(message, scope);
    this.sources.set(message.id, { message, units });
    return units;
  }
  group(members: readonly SourceUnit[], open: boolean, build: () => readonly DisplayUnit[]): readonly DisplayUnit[] {
    const key = members[0]!.key;
    this.seen.groups.add(key);
    const previous = this.groups.get(key);
    if (previous && previous.open === open && sameMembers(previous.members, members)) return previous.units;
    const units = build();
    this.groups.set(key, { members, open, units });
    return units;
  }
  turn(next: TurnDisclosure): TurnDisclosure {
    this.seen.turns.add(next.key);
    const previous = this.turns.get(next.key);
    if (previous && sameTurn(previous, next)) return previous;
    this.turns.set(next.key, next);
    return next;
  }
  message(next: MessagePresentation): MessagePresentation {
    this.seen.messages.add(next.messageId);
    const previous = this.messages.get(next.messageId);
    if (previous && sameMessage(previous, next)) return previous;
    this.messages.set(next.messageId, next);
    return next;
  }
  finish() {
    prune(this.sources, this.seen.sources);
    prune(this.groups, this.seen.groups);
    prune(this.turns, this.seen.turns);
    prune(this.messages, this.seen.messages);
  }
}

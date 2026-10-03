import type { DisplayUnit, SourceUnit } from './turn-types';

export function indexSourceTurns(units: readonly SourceUnit[]) {
  const members = new Map<string, SourceUnit[]>();
  const interrupted = new Set<string>();
  let previousKey: string | undefined;
  for (const unit of units) {
    const key = unit.turnKey;
    if (key) {
      let group = members.get(key);
      if (group && key !== previousKey) interrupted.add(key);
      if (!group) members.set(key, (group = []));
      group.push(unit);
    }
    previousKey = key;
  }
  return { members, interrupted };
}
export function indexDisplayUnits(groups: readonly DisplayUnit[]) {
  const messages = new Map<string, DisplayUnit[]>();
  const work = new Map<string, string[]>();
  const shared = new Set<SourceUnit>();
  for (const group of groups) {
    let units = messages.get(group.messageId);
    if (!units) messages.set(group.messageId, (units = []));
    units.push(group);
    if (group.work && group.turnKey) {
      let keys = work.get(group.turnKey);
      if (!keys) work.set(group.turnKey, (keys = []));
      keys.push(group.key);
    }
    const members = group.activity?.members;
    if (members?.some((member) => member.messageId !== members[0]!.messageId))
      for (const member of members) shared.add(member);
  }
  return { messages, work, shared };
}

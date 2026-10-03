import type { ThreadMessage } from '@assistant-ui/react';
import { activityMemberIdentity, buildActivityGroups } from './build-activity-groups';
import { resolveToolStatus } from './tool-status';
import { toolKind } from './tool-kind';
import { messageSourceUnits } from './turn-source-units';
import { verifiedTurnTiming, turnDuration } from './turn-timing';
import type { DisplayUnit, SourceUnit, TurnDisclosure, TurnPresentation, TurnScope } from './turn-types';

function groupUnits(units: readonly SourceUnit[], scope: TurnScope): DisplayUnit[] {
  const chunks: SourceUnit[][] = [];
  for (const unit of units) {
    const last = chunks[chunks.length - 1];
    if (last && last[0]!.work === unit.work && last[0]!.turnKey === unit.turnKey) last.push(unit);
    else chunks.push([unit]);
  }
  return chunks.flatMap((chunk, index) =>
    buildActivityGroups(chunk, scope.pendingToolIds, index === chunks.length - 1).map((entry) => {
      if (entry.type === 'standalone') return entry.member as SourceUnit;
      const members = entry.members as readonly SourceUnit[];
      return { ...members[0]!, activity: { group: entry, members } };
    }),
  );
}

function unsafePart(unit: SourceUnit, scope: TurnScope): boolean {
  return (
    unit.part.type === 'tool-call' &&
    ['failed', 'stopped', 'declined'].includes(resolveToolStatus(unit.part, scope.pendingToolIds))
  );
}
function turn(
  units: readonly SourceUnit[],
  all: readonly (SourceUnit | null)[],
  scope: TurnScope,
  now: number,
): TurnDisclosure {
  const key = units[0]!.turnKey!;
  const contexts = units.map((unit) => unit.presentation!);
  const first = all.indexOf(units[0]!),
    last = all.indexOf(units[units.length - 1]!);
  const unsafe =
    contexts.some((context) => ['cancelled', 'failed', 'invalid', 'unknown'].includes(context.state)) ||
    units.some((unit) => unsafePart(unit, scope)) ||
    all.slice(first, last + 1).some((unit) => !unit || unit.turnKey !== key);
  const finals = units.filter((unit) => unit.final);
  const eligible = finals.some((unit) =>
    unit.presentation?.provider === 'codex'
      ? ['running', 'completed'].includes(unit.presentation.state)
      : unit.presentation?.provider === 'claude' && contexts.every((context) => context.state === 'completed'),
  );
  const work = units.filter((unit) => unit.work && (unit.part.type !== 'text' || unit.part.text.trim()));
  return {
    key,
    workKeys: work.map((unit) => unit.key),
    innerKeys: work.map(activityMemberIdentity),
    firstWorkKey: work[0]?.key,
    available: work.length > 0 && eligible,
    unsafe,
    invalid: contexts.some((context) => context.state === 'invalid'),
    activeAgent: units.some(
      (unit) =>
        unit.part.type === 'tool-call' &&
        toolKind(unit.part.toolName) === 'subagent' &&
        resolveToolStatus(unit.part, scope.pendingToolIds) === 'running',
    ),
    running: contexts.some((context) => context.state === 'running'),
    timing: verifiedTurnTiming(units, now),
  };
}
function timingKey(
  message: ThreadMessage,
  units: readonly SourceUnit[],
  turns: ReadonlyMap<string, TurnDisclosure>,
  now: number,
): string | undefined {
  const key = units[0]?.turnKey;
  const model = key && turns.get(key);
  if (
    !model ||
    !model.available ||
    model.unsafe ||
    model.timing?.startedAtMs === undefined ||
    model.timing.completedAtMs === undefined ||
    units.some((unit) => unit.turnKey !== key)
  )
    return undefined;
  const duration = turnDuration(model.timing, false, now);
  return duration !== undefined && message.metadata.timing?.totalStreamTime === duration ? key : undefined;
}
function boundaryUnit(index: number, scope: TurnScope): SourceUnit {
  return {
    ...scope,
    key: `boundary:${index}`,
    messageId: `boundary:${index}`,
    index: 0,
    part: { type: 'text', text: '\n', status: { type: 'complete' } },
    work: false,
    final: false,
    protected: true,
    boundary: true,
  };
}
export function buildTurnDisclosures(
  messages: readonly ThreadMessage[],
  scope: TurnScope,
  now = Date.now(),
): TurnPresentation {
  const byMessage = messages.map((message) => ({ message, units: messageSourceUnits(message, scope) }));
  const all = byMessage.flatMap(({ message, units }) =>
    message.role === 'assistant' && units.length ? units : [null],
  );
  const members = new Map<string, SourceUnit[]>();
  for (const unit of all)
    if (unit?.turnKey) {
      const group = members.get(unit.turnKey) ?? [];
      group.push(unit);
      members.set(unit.turnKey, group);
    }
  const turns = new Map([...members].map(([key, units]) => [key, turn(units, all, scope, now)]));
  const groups = groupUnits(
    all.map((unit, index) => unit ?? boundaryUnit(index, scope)),
    scope,
  );
  for (const [key, model] of turns) {
    const workKeys = groups.filter((unit) => unit.turnKey === key && unit.work).map((unit) => unit.key);
    turns.set(key, { ...model, workKeys, firstWorkKey: workKeys[0] });
  }
  return {
    turns,
    messages: byMessage.map(({ message, units }) => ({
      messageId: message.id,
      native: !units.length,
      footerInDetails:
        units.length > 0 &&
        units.every((unit) =>
          groups.some(
            (group) =>
              group.activity?.members.includes(unit) &&
              group.activity.members.some((member) => member.messageId !== message.id),
          ),
        ),
      units: groups.filter((unit) => unit.messageId === message.id),
      timingTurnKey: timingKey(message, units, turns, now),
    })),
  };
}

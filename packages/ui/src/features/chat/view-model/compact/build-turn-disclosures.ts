import type { ThreadMessage } from '@assistant-ui/react';
import { activityMemberIdentity, buildActivityGroups } from './build-activity-groups';
import { resolveToolStatus } from './tool-status';
import { toolKind } from './tool-kind';
import { TurnPresentationCache } from './turn-presentation-cache';
import { indexDisplayUnits, indexSourceTurns } from './turn-disclosure-index';
import { verifiedTurnTiming, turnDuration } from './turn-timing';
import type { DisplayUnit, SourceUnit, TurnDisclosure, TurnPresentation, TurnScope } from './turn-types';

function groupUnits(units: readonly SourceUnit[], scope: TurnScope, cache: TurnPresentationCache): DisplayUnit[] {
  const chunks: SourceUnit[][] = [];
  for (const unit of units) {
    const last = chunks[chunks.length - 1];
    if (
      last &&
      last[0]!.work === unit.work &&
      last[0]!.turnKey === unit.turnKey &&
      (unit.turnKey || last[0]!.messageId === unit.messageId)
    )
      last.push(unit);
    else chunks.push([unit]);
  }
  return chunks.flatMap((chunk, index) =>
    cache.group(
      chunk,
      index === chunks.length - 1,
      () =>
        buildActivityGroups(chunk, scope.pendingToolIds, index === chunks.length - 1, !!scope.isRunning).map(
          (entry) => {
            if (entry.type === 'standalone') return entry.member as SourceUnit;
            const members = entry.members as readonly SourceUnit[];
            return { ...members[0]!, activity: { group: entry, members } };
          },
        ),
      !!scope.isRunning,
    ),
  );
}

function turn(
  units: readonly SourceUnit[],
  interrupted: boolean,
  workKeys: readonly string[],
  scope: TurnScope,
  now: number,
): TurnDisclosure {
  const key = units[0]!.turnKey!;
  const contexts = units.map((unit) => unit.presentation!);
  const unsafe =
    contexts.some((context) => ['cancelled', 'failed', 'invalid', 'unknown'].includes(context.state)) || interrupted;
  const finals = units.filter((unit) => unit.final);
  const completed = contexts.every((context) => context.state === 'completed');
  const eligible =
    (completed && contexts.every((context) => context.provider === 'codex' && context.phase !== undefined)) ||
    finals.some((unit) =>
      unit.presentation?.provider === 'codex'
        ? ['running', 'completed'].includes(unit.presentation.state)
        : unit.presentation?.provider === 'claude' && completed,
    );
  const work = units.filter((unit) => unit.work && (unit.part.type !== 'text' || unit.part.text.trim()));
  return {
    key,
    workKeys,
    innerKeys: work.map(activityMemberIdentity),
    firstWorkKey: workKeys[0],
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
  return duration !== undefined && message.metadata?.timing?.totalStreamTime === duration ? key : undefined;
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
  cache = new TurnPresentationCache(),
): TurnPresentation {
  cache.begin(scope);
  const byMessage = messages.map((message) => ({ message, units: cache.sourceUnits(message, scope) }));
  const all = byMessage.flatMap(({ units }, index) => (units.length ? units : [boundaryUnit(index, scope)]));
  const sourceIndex = indexSourceTurns(all);
  const groups = groupUnits(all, scope, cache);
  const displayIndex = indexDisplayUnits(groups);
  const turns = new Map(
    [...sourceIndex.members].map(([key, units]) => [
      key,
      cache.turn(turn(units, sourceIndex.interrupted.has(key), displayIndex.work.get(key) ?? [], scope, now)),
    ]),
  );
  const presentations = byMessage.map(({ message, units }) =>
    cache.message({
      messageId: message.id,
      native: !units.length,
      footerInDetails: units.length > 0 && units.every((unit) => displayIndex.shared.has(unit)),
      units: displayIndex.messages.get(message.id) ?? [],
      timingTurnKey: timingKey(message, units, turns, now),
    }),
  );
  cache.finish();
  return {
    turns,
    messages: presentations,
    messagesById: new Map(presentations.map((message) => [message.messageId, message])),
  };
}

import { summarizeCommandActions } from './command-actions';
import { classifyCommand } from './command-classify';
import { parseShellCommand } from './shell-command';
import { toolKind } from './tool-kind';
import { toolLabel } from './tool-label';
import { resolveToolStatus } from './tool-status';
import { record } from './values';
import { activityMemberIdentity } from './build-activity-groups';
import type { ActivityGroup, ActivityLabel, ActivityMember, CompactToolPart } from './types';

export type ExplorationKind = 'read' | 'grep' | 'list';
export function explorationKind(part: CompactToolPart): ExplorationKind | undefined {
  const kind = toolKind(part.toolName);
  if (kind === 'read' || kind === 'list') return kind;
  if (kind === 'grep' || kind === 'glob') return 'grep';
  if (kind !== 'shell') return undefined;
  const tokens = parseShellCommand(record(part.args)?.command);
  const action =
    summarizeCommandActions(record(part.providerMetadata?.codex)?.commandActions) ??
    (tokens ? classifyCommand(tokens) : undefined);
  return action && (action.kind === 'read' || action.kind === 'grep' || action.kind === 'list')
    ? action.kind
    : undefined;
}
export function isExploration(part: CompactToolPart): boolean {
  return explorationKind(part) !== undefined;
}
function label(member: ActivityMember): ActivityLabel {
  const part = member.part;
  return {
    identity: activityMemberIdentity(member),
    text: part.type === 'tool-call' ? toolLabel([part], toolKind(part.toolName), 'running') : 'Thinking',
  };
}
function isRunning(member: ActivityMember, pending: ReadonlySet<string>): boolean {
  const part = member.part;
  if (part.type === 'tool-call') return resolveToolStatus(part, pending) === 'running';
  return part.type === 'reasoning' && part.status.type === 'running';
}
export function hasRunningMember(group: ActivityGroup, pending: ReadonlySet<string>): boolean {
  return group.members.some((member) => isRunning(member, pending));
}
export function activityLabel(group: ActivityGroup, pending: ReadonlySet<string>): ActivityLabel {
  const tools = group.members.filter((member) => member.part.type === 'tool-call');
  const running = tools.filter(
    (member) => member.part.type === 'tool-call' && resolveToolStatus(member.part, pending) === 'running',
  );
  const selected = running[running.length - 1];
  return selected ? label(selected) : { identity: 'thinking', text: 'Thinking' };
}

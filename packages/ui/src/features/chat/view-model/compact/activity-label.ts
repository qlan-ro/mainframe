import { summarizeCommandActions } from './command-actions';
import { classifyCommand } from './command-classify';
import { parseShellCommand } from './shell-command';
import { toolKind } from './tool-kind';
import { toolLabel } from './tool-label';
import { resolveToolStatus } from './tool-status';
import { record } from './values';
import { activityMemberIdentity } from './build-activity-groups';
import type { ActivityGroup, ActivityLabel, ActivityMember, CompactToolPart } from './types';

export function isExploration(part: CompactToolPart): boolean {
  const kind = toolKind(part.toolName);
  if (['read', 'grep', 'glob', 'list'].includes(kind)) return true;
  if (kind !== 'shell') return false;
  const tokens = parseShellCommand(record(part.args)?.command);
  const action =
    summarizeCommandActions(record(part.providerMetadata?.codex)?.commandActions) ??
    (tokens ? classifyCommand(tokens) : undefined);
  return !!action && ['read', 'grep', 'list'].includes(action.kind);
}
function label(member: ActivityMember): ActivityLabel {
  const part = member.part;
  return {
    identity: activityMemberIdentity(member),
    text: part.type === 'tool-call' ? toolLabel([part], toolKind(part.toolName), 'running') : 'Thinking',
  };
}
export function activityLabel(group: ActivityGroup, pending: ReadonlySet<string>): ActivityLabel {
  const tools = group.members.filter((member) => member.part.type === 'tool-call');
  const running = tools.filter(
    (member) => member.part.type === 'tool-call' && resolveToolStatus(member.part, pending) === 'running',
  );
  const exploration = running.filter((member) => member.part.type === 'tool-call' && isExploration(member.part));
  const known = tools.filter((member) => member.part.type === 'tool-call' && isExploration(member.part));
  const candidates = exploration.length ? exploration : running.length ? running : known;
  const selected = candidates[candidates.length - 1];
  return selected ? label(selected) : { identity: 'thinking', text: 'Thinking' };
}

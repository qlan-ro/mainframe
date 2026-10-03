import { isFullCard, toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import type { ActivityEntry, ActivityMember } from './types';

function routine(member: ActivityMember, pending: ReadonlySet<string>): boolean {
  const { part, presentation } = member;
  if (member.boundary || (presentation?.phase && presentation.phase !== 'work')) return false;
  if (part.type === 'reasoning') return part.status.type !== 'incomplete';
  if (part.type !== 'tool-call' || isFullCard(part.toolName)) return false;
  const kind = toolKind(part.toolName);
  return kind !== 'unknown' && kind !== 'subagent' && ['running', 'success'].includes(resolveToolStatus(part, pending));
}
function compatible(a: ActivityMember, b: ActivityMember): boolean {
  if (a.rootThreadId !== b.rootThreadId || JSON.stringify(a.ancestors) !== JSON.stringify(b.ancestors)) return false;
  const x = a.presentation;
  const y = b.presentation;
  if (x?.state === 'invalid' && y?.state === 'invalid') return a.messageId === b.messageId;
  if (!x || !y || x.state === 'invalid' || y.state === 'invalid') return a.messageId === b.messageId && x === y;
  return x.provider === y.provider && x.turnId === y.turnId && x.parentToolUseId === y.parentToolUseId;
}
function explicitlyActive(member: ActivityMember, pending: ReadonlySet<string>): boolean {
  if (member.presentation) return member.presentation.state === 'running';
  return member.part.type === 'tool-call'
    ? resolveToolStatus(member.part, pending) === 'running'
    : member.part.status.type === 'running';
}
export function buildActivityGroups(
  members: readonly ActivityMember[],
  pending: ReadonlySet<string>,
  openSlice = true,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  let run: ActivityMember[] = [];
  const flush = () => {
    if (run.length) entries.push({ type: 'activity', members: run, active: false });
    run = [];
  };
  for (const member of members) {
    if (member.part.type === 'text' && !member.part.text.trim() && !member.boundary) continue;
    if (!routine(member, pending)) {
      flush();
      entries.push({ type: 'standalone', member });
    } else {
      if (run.length && !compatible(run[run.length - 1]!, member)) flush();
      run.push(member);
    }
  }
  flush();
  const last = entries[entries.length - 1];
  if (last?.type === 'activity' && openSlice && last.members.some((member) => explicitlyActive(member, pending)))
    entries[entries.length - 1] = { ...last, active: true };
  return entries;
}

export function activityMemberIdentity(member: ActivityMember): string {
  const part = member.part;
  const id =
    part.type === 'tool-call'
      ? `tool:${part.toolCallId}`
      : `reasoning:${member.sourceMessageId ? JSON.stringify([member.sourceMessageId, member.sourceBlockIndex]) : member.index}`;
  return JSON.stringify([member.rootThreadId, member.ancestors, member.messageId, id]);
}

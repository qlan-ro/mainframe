import { isFullCard, toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import type { ActivityEntry, ActivityMember } from './types';

function routine(member: ActivityMember, pending: ReadonlySet<string>): boolean {
  const { part, presentation } = member;
  if (member.boundary) return false;
  if (part.type === 'reasoning') return part.status.type !== 'incomplete';
  if (presentation?.phase && presentation.phase !== 'work') return false;
  if (part.type !== 'tool-call' || isFullCard(part.toolName)) return false;
  const kind = toolKind(part.toolName);
  return (
    kind !== 'unknown' &&
    kind !== 'subagent' &&
    ['running', 'success', 'failed'].includes(resolveToolStatus(part, pending))
  );
}
function compatible(a: ActivityMember, b: ActivityMember): boolean {
  if (a.rootThreadId !== b.rootThreadId || JSON.stringify(a.ancestors) !== JSON.stringify(b.ancestors)) return false;
  const x = a.presentation;
  const y = b.presentation;
  if (x?.state === 'invalid' && y?.state === 'invalid') return a.messageId === b.messageId;
  if (!x || !y || x.state === 'invalid' || y.state === 'invalid') return a.messageId === b.messageId && x === y;
  return x.provider === y.provider && x.turnId === y.turnId && x.parentToolUseId === y.parentToolUseId;
}
function explicitlyActive(member: ActivityMember, pending: ReadonlySet<string>, turnInProgress: boolean): boolean {
  if (member.presentation) return member.presentation.state === 'running';
  if (turnInProgress) return true;
  return member.part.type === 'tool-call'
    ? resolveToolStatus(member.part, pending) === 'running'
    : member.part.status.type === 'running';
}
function appendGroup(entries: ActivityEntry[], members: ActivityMember[], bridgeSubagents: boolean): void {
  if (!members.length) return;
  if (bridgeSubagents) {
    let index = entries.length - 1;
    while (index >= 0) {
      const entry = entries[index]!;
      if (entry.type === 'activity') {
        if (compatible(entry.members[entry.members.length - 1]!, members[0]!)) {
          entries[index] = { ...entry, members: [...entry.members, ...members] };
          return;
        }
        break;
      }
      if (
        entry.member.boundary ||
        !compatible(entry.member, members[0]!) ||
        entry.member.part.type !== 'tool-call' ||
        toolKind(entry.member.part.toolName) !== 'subagent'
      )
        break;
      index--;
    }
  }
  entries.push({ type: 'activity', members, active: false });
}
export function buildActivityGroups(
  members: readonly ActivityMember[],
  pending: ReadonlySet<string>,
  openSlice = true,
  turnInProgress = false,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  let run: ActivityMember[] = [];
  const bridgeSubagents = members.every((member) => member.presentation?.state === 'completed');
  const flush = () => {
    appendGroup(entries, run, bridgeSubagents);
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
  if (
    last?.type === 'activity' &&
    openSlice &&
    last.members.some((member) => explicitlyActive(member, pending, turnInProgress))
  )
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

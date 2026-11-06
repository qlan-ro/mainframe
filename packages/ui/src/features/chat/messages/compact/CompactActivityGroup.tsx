import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { BrainIcon, Loader2Icon } from 'lucide-react';
import type { ActivityGroup } from '../../view-model/compact/types';
import { activityMemberIdentity } from '../../view-model/compact/build-activity-groups';
import { activityLabel, hasRunningMember } from '../../view-model/compact/activity-label';
import { hasActivityDetail } from '../../view-model/compact/activity-details';
import { activitySummary } from '../../view-model/compact/activity-summary';
import { toolKind } from '../../view-model/compact/tool-kind';
import { CompactDisclosure } from './CompactDisclosure';
import { buildCompactRows } from '../../view-model/compact/build-compact-rows';
import { CompactToolRow, kindIcons } from './CompactToolRow';
import { ReasoningText } from '../../parts/ReasoningText';
import { CompactReasoningRow } from './CompactReasoningRow';
import { disclosureKey } from './disclosure-store';
import { TranscriptScopeProvider, useTranscriptScope } from './transcript-scope';
import { useStableActivityLabel } from './use-stable-activity-label';
import { TurnStatusTrailing } from '../../thread/TurnStatusRow';
import { useTurnStatusHost } from '../../thread/turn-status-host';

const reasoningComponents = { Reasoning: ReasoningText };
// A settled lone call renders without its group, so its row takes the group's own disclosure key:
// the turn fold's guard sees it open, and its state carries over when the group regrows.
const LoneRow = createContext(false);
export function CompactDetailRows({ indices, nested = false }: { indices: readonly number[]; nested?: boolean }) {
  const parts = useAuiState((s) => s.message.parts);
  const messageId = useAuiState((s) => s.message.id);
  const scope = useTranscriptScope();
  const lone = useContext(LoneRow);
  const rows = useMemo(
    () =>
      buildCompactRows(
        indices.flatMap((index) => (parts[index] ? [{ index, part: parts[index]! }] : [])),
        scope.pendingToolIds,
      ),
    [indices, parts, scope.pendingToolIds],
  );
  const keyFor = (id: string) =>
    disclosureKey(scope.rootThreadId, scope.ancestors, messageId, nested && !lone ? `detail:${id}` : id);
  return (
    <>
      {rows.map((row) => {
        if (row.type === 'tool') {
          const keys = row.toolCallIds.map((id) => keyFor(`tool:${id}`));
          return <CompactToolRow key={keys[0]} row={row} memberKeys={keys} />;
        }
        if (row.type === 'reasoning') {
          const key = keyFor(`reasoning:${row.indices[0]}`);
          const text = row.indices.map((index) => (
            <MessagePrimitive.PartByIndex key={index} index={index} components={reasoningComponents} />
          ));
          return (
            <CompactReasoningRow key={key} memberKeys={[key]} running={row.running}>
              {text}
            </CompactReasoningRow>
          );
        }
        return null;
      })}
    </>
  );
}

const Indices = createContext<readonly number[]>([]);
function SourceDetails() {
  const indices = useContext(Indices);
  const parent = useTranscriptScope();
  const messageId = useAuiState((s) => s.message.id);
  const scope = useMemo(() => ({ ...parent, messageId }), [parent, messageId]);
  return (
    <TranscriptScopeProvider value={scope}>
      <CompactDetailRows indices={indices} nested />
    </TranscriptScopeProvider>
  );
}
const components = { AssistantMessage: SourceDetails, UserMessage: () => null };
function ActivityDetails({ group }: { group: ActivityGroup }) {
  const { pendingToolIds } = useTranscriptScope();
  const chunks: Array<{ messageId: string; indices: number[] }> = [];
  for (const member of group.members) {
    if (!hasActivityDetail(member.part, pendingToolIds)) continue;
    const last = chunks[chunks.length - 1];
    if (last?.messageId === member.messageId) last.indices.push(member.index);
    else chunks.push({ messageId: member.messageId, indices: [member.index] });
  }
  return (
    <>
      {chunks.map(({ messageId, indices }) => (
        <Indices.Provider key={JSON.stringify([messageId, indices[0]])} value={indices}>
          <ThreadPrimitive.Unstable_MessageById messageId={messageId} components={components} />
        </Indices.Provider>
      ))}
    </>
  );
}
// A settled group shows what it mostly was, aligned with standalone rows, rather than a done mark.
function SettledIcon({ group }: { group: ActivityGroup }) {
  const first = group.members.find((member) => member.part.type === 'tool-call')?.part;
  const Icon = first?.type === 'tool-call' ? kindIcons[toolKind(first.toolName)] : BrainIcon;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}
export function CompactActivityGroup({ group, details }: { group: ActivityGroup; details?: ReactNode }) {
  const scope = useTranscriptScope();
  // A running member keeps the header live even when the group is not the turn's open tail.
  const active = group.active || hasRunningMember(group, scope.pendingToolIds);
  const candidate = active
    ? activityLabel(group, scope.pendingToolIds)
    : { identity: 'completed', text: activitySummary(group.members) };
  const label = useStableActivityLabel(candidate, active);
  // The live group ending a running turn hosts the turn's clock and tasks; the status row steps aside.
  const hostsTurnStatus = useTurnStatusHost() === activityMemberIdentity(group.members[0]!);
  const body = details ?? <ActivityDetails group={group} />;
  // A settled lone call is just that call: its own row, without a summary wrapped around it.
  if (!active && group.members.length === 1 && group.members[0]!.part.type === 'tool-call')
    return <LoneRow.Provider value>{body}</LoneRow.Provider>;
  return (
    <CompactDisclosure
      memberKeys={group.members.map(activityMemberIdentity)}
      expandable={group.members.some((member) => hasActivityDetail(member.part, scope.pendingToolIds))}
      maxDetailHeight="min(224px, 50cqh)"
      label={label}
      live={active}
      trailing={hostsTurnStatus ? <TurnStatusTrailing /> : undefined}
      icon={
        active ? (
          <Loader2Icon aria-label="running" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : (
          <SettledIcon group={group} />
        )
      }
    >
      <div
        data-testid="chat-compact-activity-members"
        className="min-w-0 space-y-0.5 rounded-md border border-border bg-card px-2.5 py-1"
      >
        {body}
      </div>
    </CompactDisclosure>
  );
}

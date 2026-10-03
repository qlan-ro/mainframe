import { createContext, useContext, useMemo } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { CheckIcon, Loader2Icon } from 'lucide-react';
import type { ActivityGroup, CompactToolRow as ToolRow } from '../../view-model/compact/types';
import { activityMemberIdentity } from '../../view-model/compact/build-activity-groups';
import { activityLabel } from '../../view-model/compact/activity-label';
import { activitySummary } from '../../view-model/compact/activity-summary';
import { CompactDisclosure } from './CompactDisclosure';
import { buildCompactRows } from '../../view-model/compact/build-compact-rows';
import { CompactElapsed } from './CompactElapsed';
import { CompactToolRow } from './CompactToolRow';
import { CompactToolDetails } from './CompactToolDetails';
import { CompactReasoningRow } from './CompactReasoningRow';
import { disclosureKey } from './disclosure-store';
import { TranscriptScopeProvider, useTranscriptScope } from './transcript-scope';
import { useStableActivityLabel } from './use-stable-activity-label';

function ExpandedToolDetails({ row }: { row: ToolRow }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {row.diff && (
          <span className="shrink-0 font-mono">
            +{row.diff.added}/-{row.diff.removed}
          </span>
        )}
        <CompactElapsed
          timing={row.timing}
          running={row.status === 'running'}
          reportedDurationMs={row.reportedDurationMs}
        />
      </div>
      <CompactToolDetails indices={row.indices} />
    </div>
  );
}
function ReasoningText({ text }: { text: string }) {
  return <>{text}</>;
}
const reasoningComponents = { Reasoning: ReasoningText };
export function CompactDetailRows({ indices, expanded = false }: { indices: readonly number[]; expanded?: boolean }) {
  const parts = useAuiState((s) => s.message.parts);
  const messageId = useAuiState((s) => s.message.id);
  const scope = useTranscriptScope();
  const rows = useMemo(
    () =>
      buildCompactRows(
        indices.flatMap((index) => (parts[index] ? [{ index, part: parts[index]! }] : [])),
        scope.pendingToolIds,
      ),
    [indices, parts, scope.pendingToolIds],
  );
  const keyFor = (id: string) => disclosureKey(scope.rootThreadId, scope.ancestors, messageId, id);
  return (
    <>
      {rows.map((row) => {
        if (row.type === 'tool') {
          const keys = row.toolCallIds.map((id) => keyFor(`tool:${id}`));
          return expanded ? (
            <ExpandedToolDetails key={keys[0]} row={row} />
          ) : (
            <CompactToolRow key={keys[0]} row={row} memberKeys={keys} />
          );
        }
        if (row.type === 'reasoning') {
          const key = keyFor(`reasoning:${row.indices[0]}`);
          const text = row.indices.map((index) => (
            <MessagePrimitive.PartByIndex key={index} index={index} components={reasoningComponents} />
          ));
          return expanded ? (
            <div key={key} className="whitespace-pre-wrap text-sm text-muted-foreground">
              {text}
            </div>
          ) : (
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
      <CompactDetailRows indices={indices} expanded />
    </TranscriptScopeProvider>
  );
}
const components = { AssistantMessage: SourceDetails, UserMessage: () => null };
function ActivityDetails({ group }: { group: ActivityGroup }) {
  const chunks: Array<{ messageId: string; indices: number[] }> = [];
  for (const member of group.members) {
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
export function CompactActivityGroup({ group }: { group: ActivityGroup }) {
  const scope = useTranscriptScope();
  const candidate = group.active
    ? activityLabel(group, scope.pendingToolIds)
    : { identity: 'completed', text: activitySummary(group.members) };
  const label = useStableActivityLabel(candidate, group.active);
  const Icon = group.active ? Loader2Icon : CheckIcon;
  return (
    <CompactDisclosure
      memberKeys={group.members.map(activityMemberIdentity)}
      label={label}
      icon={
        <Icon
          aria-label={group.active ? 'running' : 'completed'}
          className={`size-3.5 shrink-0 ${group.active ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
      }
    >
      <ActivityDetails group={group} />
    </CompactDisclosure>
  );
}

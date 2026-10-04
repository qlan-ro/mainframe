import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { activityMemberIdentity, buildActivityGroups } from '../../view-model/compact/build-activity-groups';
import { CompactActivityGroup, CompactDetailRows } from './CompactActivityGroup';
import { useTranscriptScope } from './transcript-scope';

export function CompactRows({ indices }: { indices: readonly number[] }) {
  const parts = useAuiState((s) => s.message.parts);
  const messageId = useAuiState((s) => s.message.id);
  const scope = useTranscriptScope();
  const isLatestRunning = useAuiState(
    (s) => s.thread.isRunning && s.thread.messages[s.thread.messages.length - 1]?.id === s.message.id,
  );
  const groups = useMemo(
    () =>
      buildActivityGroups(
        indices.flatMap((index) =>
          parts[index]
            ? [{ index, part: parts[index]!, messageId, rootThreadId: scope.rootThreadId, ancestors: scope.ancestors }]
            : [],
        ),
        scope.pendingToolIds,
        !parts.slice((indices[indices.length - 1] ?? -1) + 1).some((part) => part.type !== 'text' || part.text.trim()),
        isLatestRunning,
      ),
    [indices, parts, messageId, scope.rootThreadId, scope.ancestors, scope.pendingToolIds, isLatestRunning],
  );
  return (
    <>
      {groups.map((entry) =>
        entry.type === 'activity' ? (
          <CompactActivityGroup key={activityMemberIdentity(entry.members[0]!)} group={entry} />
        ) : (
          <CompactDetailRows key={activityMemberIdentity(entry.member)} indices={[entry.member.index]} />
        ),
      )}
    </>
  );
}

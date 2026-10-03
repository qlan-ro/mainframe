import { useMemo } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { buildCompactRows } from '../../view-model/compact/build-compact-rows';
import { CompactToolRow } from './CompactToolRow';
import { CompactReasoningRow } from './CompactReasoningRow';
import { disclosureKey } from './disclosure-store';
import { useTranscriptScope } from './transcript-scope';
import { ReasoningText } from '../../parts/ReasoningText';

const reasoningComponents = { Reasoning: ReasoningText };
export function CompactRows({ indices }: { indices: readonly number[] }) {
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
          return <CompactToolRow key={keys[0]} row={row} memberKeys={keys} />;
        }
        if (row.type === 'reasoning') {
          const key = keyFor(`reasoning:${row.indices[0]}`);
          return (
            <CompactReasoningRow key={key} memberKeys={[key]} running={row.running}>
              {row.indices.map((index) => (
                <MessagePrimitive.PartByIndex key={index} index={index} components={reasoningComponents} />
              ))}
            </CompactReasoningRow>
          );
        }
        return null;
      })}
    </>
  );
}

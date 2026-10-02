import { MessagePrimitive, useAuiState, type ToolCallMessagePartComponent } from '@assistant-ui/react';
import { resolveToolCard } from '../../tools/registry';
import { FallbackToolCard } from '../../tools/cards/FallbackToolCard';
import { SubagentTranscript } from '../../tools/cards/SubagentTranscript';
import { CompactDetailProvider } from '../../tools/shared/compact-detail-context';
import { toolKind } from '../../view-model/compact/tool-kind';

const CompactToolOverride: ToolCallMessagePartComponent = (part) => {
  const messageId = useAuiState((s) => s.message.id);
  if (toolKind(part.toolName) === 'subagent')
    return <SubagentTranscript messages={part.messages ?? []} messageId={messageId} toolCallId={part.toolCallId} />;
  const Card = resolveToolCard(part.toolName) ?? FallbackToolCard;
  return <Card {...part} />;
};
const components = { tools: { Override: CompactToolOverride } };
export function CompactToolDetails({ indices }: { indices: readonly number[] }) {
  return (
    <CompactDetailProvider value>
      {indices.map((index) => (
        <MessagePrimitive.PartByIndex key={index} index={index} components={components} />
      ))}
    </CompactDetailProvider>
  );
}

import { TextMessagePartProvider } from '@assistant-ui/react';
import type { SourceUnit } from '../../view-model/compact/turn-types';
import { ReasoningText } from '../../parts/ReasoningText';
import { MarkdownText } from '../../parts/markdown-text';

export function CompactTextSlice({ unit }: { unit: SourceUnit }) {
  const part = unit.part;
  if (part.type !== 'text' && part.type !== 'reasoning') return null;
  return (
    <TextMessagePartProvider text={part.text} isRunning={part.status.type === 'running'}>
      {part.type === 'text' ? (
        <MarkdownText {...part} />
      ) : (
        <div className="whitespace-pre-wrap text-sm text-muted-foreground">
          <ReasoningText {...part} />
        </div>
      )}
    </TextMessagePartProvider>
  );
}

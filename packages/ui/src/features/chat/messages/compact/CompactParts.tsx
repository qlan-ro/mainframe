import { MessagePrimitive, type PartState } from '@assistant-ui/react';
import { isFullCard } from '../../view-model/compact/tool-kind';
import { CompactRows } from './CompactRows';
import { MessageToolLeaf } from '../../tools/tool-dispatch';
import { MarkdownText } from '../../parts/markdown-text';
import { ZoomableImage } from '../../parts/ZoomableImage';
import { useIsNestedTranscript } from '../nested-transcript-context';

export function compactGroupBy(part: PartState): readonly `group-${string}`[] {
  if (part.type === 'reasoning') return ['group-compact-activity'];
  if (part.type === 'tool-call' && !isFullCard(part.toolName)) return ['group-compact-activity'];
  if (part.type === 'text' && !part.text.trim()) return ['group-compact-activity'];
  return [];
}
export function CompactParts() {
  const nested = useIsNestedTranscript();
  return (
    <MessagePrimitive.GroupedParts groupBy={compactGroupBy} indicator={nested ? 'no-text' : 'never'}>
      {({ part }) => {
        if ('indices' in part) return <CompactRows indices={part.indices} />;
        switch (part.type) {
          case 'text':
            return <MarkdownText {...part} />;
          case 'tool-call':
            return <MessageToolLeaf part={part} />;
          case 'image':
            return (
              <ZoomableImage
                src={part.image}
                className="max-h-80 max-w-full rounded-md border border-border object-contain"
              />
            );
          case 'indicator':
            return (
              <span
                aria-label="Assistant is working"
                className="inline-block size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
              />
            );
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

import { useMemo } from 'react';
import { MessagePrimitive } from '@assistant-ui/react';
import { makeChatGroupBy, parseToolGroupKey } from '../tools/group-parts';
import { useMainframeMeta } from '../view-model/message-meta';
import { MarkdownText } from '../parts/markdown-text';
import { ReasoningGroup } from './ReasoningGroup';
import { MessageToolLeaf, MessageToolGroup } from '../tools/tool-dispatch';
import { ZoomableImage } from '../parts/ZoomableImage';
import { useIsNestedTranscript } from './nested-transcript-context';

function RunningIndicator() {
  return (
    <span
      data-slot="message-indicator"
      aria-label="Assistant is working"
      className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
    />
  );
}

export function VerboseParts() {
  const meta = useMainframeMeta();
  const groupBy = useMemo(() => makeChatGroupBy(meta.partGroups ?? {}), [meta.partGroups]);
  const summaries = meta.groupSummaries;
  const isNested = useIsNestedTranscript();
  return (
    <MessagePrimitive.GroupedParts groupBy={groupBy} indicator={isNested ? 'no-text' : 'never'}>
      {({ part, children }) => {
        if ('indices' in part) {
          if (part.type === 'group-reasoning') {
            return <ReasoningGroup running={part.status?.type === 'running'}>{children}</ReasoningGroup>;
          }
          const groupId = parseToolGroupKey(part.type) ?? '';
          return (
            <MessageToolGroup
              indices={part.indices}
              running={part.status?.type === 'running'}
              summary={summaries?.[groupId]}
            >
              {children}
            </MessageToolGroup>
          );
        }

        switch (part.type) {
          case 'text':
            return <MarkdownText {...part} />;
          case 'reasoning':
            return <div className="whitespace-pre-wrap">{part.text}</div>;
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
            return <RunningIndicator />;
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

'use client';

/**
 * Assistant message renderer — the native GroupedParts dispatch.
 *
 * `groupBy` echoes the daemon's grouping (read from message metadata): explore
 * runs coalesce into a ToolGroup (header summary carried in metadata), reasoning
 * coalesces into one collapsed native Reasoning block (auto-open while
 * streaming), standalone tools float on their own line. Text renders as
 * markdown, tools through the registry. A hover action bar (copy/export) +
 * timing footer sit under the turn. The \0 permission sentinel renders nothing.
 */
import { useMemo } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { makeChatGroupBy, parseToolGroupKey } from '../tools/group-parts';
import { useMainframeMeta } from '../view-model/message-meta';
import { PERMISSION_PLACEHOLDER } from '../view-model/convert-message';
import { MarkdownText } from '../parts/markdown-text';
import { ReasoningGroup } from './ReasoningGroup';
import { MessageToolLeaf, MessageToolGroup } from '../tools/tool-dispatch';
import { ZoomableImage } from '../parts/ZoomableImage';
import { MessageActionBar } from './MessageActionBar';
import { MessageTiming } from './MessageTiming';
import { MessageTimestamp } from './MessageTimestamp';
import { AssistantErrorBlock } from './AssistantErrorBlock';
import { MessagePathContextMenu } from './MessagePathContextMenu';
import { useIsNestedTranscript } from './nested-transcript-context';

/** Nested-only: the top-level thread has ChatThread's labelled indicator instead. */
function RunningIndicator() {
  return (
    <span
      data-slot="message-indicator"
      aria-label="Assistant is working"
      // `warning` = wrong-but-not-broken in v2, and "working" is neither — the
      // accent is what the app already uses for an in-progress signal.
      className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
    />
  );
}

export function AssistantMessage() {
  const meta = useMainframeMeta();
  const groupBy = useMemo(() => makeChatGroupBy(meta.partGroups ?? {}), [meta.partGroups]);
  const summaries = meta.groupSummaries;
  const messageId = useAuiState((s) => s.message.id);
  const isNested = useIsNestedTranscript();

  // Error turn → a styled destructive block instead of plain assistant prose.
  if (meta.errorText) {
    return (
      <MessagePrimitive.Root data-testid="chat-assistant-message" data-message-id={messageId} className="py-2">
        <Message>
          <MessageContent>
            <AssistantErrorBlock text={meta.errorText} />
          </MessageContent>
        </Message>
      </MessagePrimitive.Root>
    );
  }

  const groupedParts = (
    // `never` at the top level — ChatThread's GeneratingIndicator already carries
    // the pulse dot; nested transcripts have no such row, so they keep the default.
    <MessagePrimitive.GroupedParts groupBy={groupBy} indicator={isNested ? 'no-text' : 'never'}>
      {({ part, children }) => {
        // GroupPart nodes carry `indices`; leaf parts do not.
        if ('indices' in part) {
          if (part.type === 'group-reasoning') {
            return <ReasoningGroup running={part.status?.type === 'running'}>{children}</ReasoningGroup>;
          }
          // group-tool-<groupId>: the summary was derived in the projection.
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
            // MarkdownText reads the text from part context; props satisfy the type.
            return part.text === PERMISSION_PLACEHOLDER.text ? null : <MarkdownText {...part} />;
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

  return (
    <MessagePrimitive.Root data-testid="chat-assistant-message" data-message-id={messageId} className="py-2">
      <Message>
        <MessageContent>
          {isNested ? groupedParts : <MessagePathContextMenu>{groupedParts}</MessagePathContextMenu>}

          {/* Reserve the action-bar height so hover-revealing it doesn't shift the
              layout. `px-0`: the kit pads the footer for a bubble turn, and an
              assistant turn has none — the row would sit indented under its prose. */}
          <MessageFooter className="min-h-6 gap-2 px-0">
            <MessageActionBar />
            <MessageTimestamp />
            <MessageTiming />
          </MessageFooter>
        </MessageContent>
      </Message>
    </MessagePrimitive.Root>
  );
}

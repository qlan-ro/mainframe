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
import { MessagePrimitive } from '@assistant-ui/react';
import { makeChatGroupBy } from '../tools/group-parts';
import { useMainframeMeta } from '../view-model/message-meta';
import { PERMISSION_PLACEHOLDER } from '../view-model/convert-message';
import { MarkdownText } from '../parts/markdown-text';
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from '@/components/ui/assistant-ui/reasoning';
import { MessageToolLeaf, MessageToolGroup } from './tool-dispatch';
import { MessageActionBar } from './MessageActionBar';
import { MessageTiming } from './MessageTiming';

function RunningIndicator() {
  return (
    <span
      data-slot="message-indicator"
      aria-label="Assistant is working"
      className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-mf-warning"
    />
  );
}

export function AssistantMessage() {
  const meta = useMainframeMeta();
  const groupBy = useMemo(() => makeChatGroupBy(meta.partGroups ?? {}), [meta.partGroups]);
  const summaries = meta.groupSummaries;

  return (
    <MessagePrimitive.Root data-testid="chat-assistant-message" className="group/message flex flex-col gap-2 py-3">
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          // GroupPart nodes carry `indices`; leaf parts do not.
          if ('indices' in part) {
            if (part.type === 'group-reasoning') {
              const running = part.status?.type === 'running';
              return (
                <ReasoningRoot defaultOpen={running} variant="ghost">
                  <ReasoningTrigger active={running} />
                  <ReasoningContent aria-busy={running}>
                    <ReasoningText>{children}</ReasoningText>
                  </ReasoningContent>
                </ReasoningRoot>
              );
            }
            // group-tool-<groupId>: the summary was derived in the projection.
            const groupId = part.type.slice('group-tool-'.length);
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
                <img
                  data-slot="message-image"
                  src={part.image}
                  alt=""
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

      {/* Reserve the action-bar height so hover-revealing it doesn't shift the layout. */}
      <div className="flex min-h-6 items-center gap-2 text-muted-foreground">
        <MessageActionBar />
        <MessageTiming />
      </div>
    </MessagePrimitive.Root>
  );
}

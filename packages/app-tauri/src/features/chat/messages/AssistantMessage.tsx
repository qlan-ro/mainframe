'use client';

/**
 * Assistant message renderer — the native GroupedParts dispatch.
 *
 * `groupBy` echoes the daemon's grouping (read from message metadata), so
 * explore runs coalesce exactly as the server decided and standalone tools
 * float onto their own line. Text renders as markdown (MarkdownText), reasoning
 * as a collapsed native block, tools through the registry. A hover action bar
 * (copy / export) + timing footer sit under the turn. The \0 permission sentinel
 * renders nothing (the permission card is sibling chrome, a later leaf).
 */
import { useMemo } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { makeChatGroupBy, type PartGroups } from '../tools/group-parts';
import { PERMISSION_PLACEHOLDER } from '../view-model/convert-message';
import { MarkdownText } from '../parts/markdown-text';
import { Reasoning } from '../parts/Reasoning';
import { MessageToolLeaf, MessageToolGroup } from './tool-dispatch';
import { MessageActionBar } from './MessageActionBar';
import { MessageTiming } from './MessageTiming';

const EMPTY_GROUPS: PartGroups = Object.freeze({});

function usePartGroups(): PartGroups {
  const meta = useAuiState((s) => s.message.metadata) as
    | { custom?: { mainframe?: { partGroups?: PartGroups } } }
    | undefined;
  return meta?.custom?.mainframe?.partGroups ?? EMPTY_GROUPS;
}

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
  const partGroups = usePartGroups();
  const groupBy = useMemo(() => makeChatGroupBy(partGroups), [partGroups]);

  return (
    <MessagePrimitive.Root data-testid="chat-assistant-message" className="group/message flex flex-col gap-2 py-3">
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          // GroupPart nodes carry `indices`; leaf parts (EnrichedPartState /
          // IndicatorPart) do not — only tool groups are produced now.
          if ('indices' in part) {
            return (
              <MessageToolGroup indices={part.indices} running={part.status?.type === 'running'}>
                {children}
              </MessageToolGroup>
            );
          }

          switch (part.type) {
            case 'text':
              // Hide the permission sentinel; everything else is markdown.
              // MarkdownText reads the text from part context; props satisfy the type.
              return part.text === PERMISSION_PLACEHOLDER.text ? null : <MarkdownText {...part} />;
            case 'reasoning':
              return <Reasoning text={part.text} />;
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

      <div className="flex items-center gap-2 text-muted-foreground">
        <MessageActionBar />
        <MessageTiming />
      </div>
    </MessagePrimitive.Root>
  );
}

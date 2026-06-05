'use client';

/**
 * Assistant message renderer — the native GroupedParts dispatch.
 *
 * `groupBy` echoes the daemon's grouping (read from message metadata), so
 * explore runs coalesce exactly as the server decided and standalone tools
 * float onto their own line. Tool dispatch goes through the single registry
 * (MessageToolLeaf). Text and reasoning get minimal styling here — the markdown
 * + native-Reasoning leaves upgrade them later. The \0 permission sentinel
 * renders nothing (the permission card is sibling chrome, a later leaf).
 */
import { useMemo } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { makeChatGroupBy, type PartGroups } from '../tools/group-parts';
import { PERMISSION_PLACEHOLDER } from '../view-model/convert-message';
import { MessageToolLeaf, MessageToolGroup } from './tool-dispatch';

const EMPTY_GROUPS: PartGroups = Object.freeze({});

function usePartGroups(): PartGroups {
  const meta = useAuiState((s) => s.message.metadata) as
    | { custom?: { mainframe?: { partGroups?: PartGroups } } }
    | undefined;
  return meta?.custom?.mainframe?.partGroups ?? EMPTY_GROUPS;
}

function TextLeaf({ text }: { text: string }) {
  if (text === PERMISSION_PLACEHOLDER.text || !text) return null;
  return (
    <div data-slot="message-text" className="text-body text-foreground whitespace-pre-wrap leading-relaxed">
      {text}
    </div>
  );
}

function ReasoningLeaf({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div data-slot="message-reasoning" className="text-caption text-muted-foreground italic whitespace-pre-wrap">
      {text}
    </div>
  );
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
    <MessagePrimitive.Root data-testid="chat-assistant-message" className="flex flex-col gap-2 py-2">
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          // GroupPart nodes carry `indices`; leaf parts (EnrichedPartState /
          // IndicatorPart) do not — this narrows the dynamic `group-tool-*` keys.
          if ('indices' in part) {
            if (part.type === 'group-reasoning') {
              return (
                <div data-slot="reasoning-group" className="flex flex-col gap-1">
                  {children}
                </div>
              );
            }
            return (
              <MessageToolGroup indices={part.indices} running={part.status?.type === 'running'}>
                {children}
              </MessageToolGroup>
            );
          }

          switch (part.type) {
            case 'text':
              return <TextLeaf text={part.text} />;
            case 'reasoning':
              return <ReasoningLeaf text={part.text} />;
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
    </MessagePrimitive.Root>
  );
}

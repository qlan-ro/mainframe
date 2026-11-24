/** A message's visible parts as units; identity is kept per message (`TurnCache`). */
import type { MessagePartState, ThreadMessage } from '@assistant-ui/react';
import { toMessagePartStatus } from '@assistant-ui/core/internal';
import { searchItemId } from '../../find/search-item';
import type { MainframeMessageMeta } from '../message-meta';
import { sourceIdentity } from '../transcript-presentation';
import { isMarkerTool } from './tool-kind';
import type { TurnScope, TurnUnit } from './types';

export const messageMeta = (message: ThreadMessage): MainframeMessageMeta | undefined =>
  message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;

const isBlank = (part: MessagePartState) => (part.type === 'text' || part.type === 'reasoning') && !part.text.trim();

/** Stable while the part is the same one: a tool call by its id, text by its item, else by its place. */
function identity(part: MessagePartState, message: ThreadMessage, index: number): string {
  if (part.type === 'tool-call') return `tool:${part.toolCallId}`;
  const source = messageMeta(message)?.partSources?.[index]?.[0];
  return source ? sourceIdentity(source) : `${part.type}:${index}`;
}

export function messageUnits(message: ThreadMessage, scope: TurnScope): readonly TurnUnit[] {
  if (message.role !== 'assistant') return [];
  const meta = messageMeta(message);
  if (meta?.errorText) return [];
  return message.content.flatMap((original, index) => {
    const part = { ...original, status: toMessagePartStatus(message, index, original) } as MessagePartState;
    if (isBlank(part)) return [];
    return [
      {
        key: JSON.stringify([scope.rootThreadId, scope.ancestors, message.id, identity(part, message, index)]),
        messageId: message.id,
        index,
        part,
        presentation: meta?.partSources?.[index]?.[0]?.presentation,
        itemId: searchItemId(part as Parameters<typeof searchItemId>[0]),
      },
    ];
  });
}

export const isMarkerUnit = (unit: TurnUnit): boolean =>
  unit.part.type === 'tool-call' && isMarkerTool(unit.part.toolName);
export const isTextUnit = (unit: TurnUnit): boolean => unit.part.type === 'text' || unit.part.type === 'image';

import type { MessagePartState, ThreadMessage } from '@assistant-ui/react';
import { toMessagePartStatus } from '@assistant-ui/core/internal';
import type { MainframeMessageMeta } from '../message-meta';
import { sourceIdentity, type NativePartSource } from '../transcript-presentation';
import { isFullCard, toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import { turnKey, type SourceUnit, type TurnScope } from './turn-types';

function protectedPart(part: MessagePartState, scope: TurnScope): boolean {
  if (part.type === 'text' || part.type === 'reasoning') return false;
  if (part.type !== 'tool-call') return true;
  return (
    isFullCard(part.toolName) ||
    ['subagent', 'unknown'].includes(toolKind(part.toolName)) ||
    !['running', 'success'].includes(resolveToolStatus(part, scope.pendingToolIds))
  );
}
function sourcePart(part: MessagePartState, source?: NativePartSource): MessagePartState {
  if (!source || (part.type !== 'text' && part.type !== 'reasoning')) return part;
  return {
    ...part,
    text: part.text.slice(source.startUtf16, source.endUtf16),
    status: source.streaming === true ? { type: 'running' } : { type: 'complete' },
  };
}
function unit(message: ThreadMessage, index: number, scope: TurnScope, source?: NativePartSource): SourceUnit {
  const original = message.content[index]!;
  const part = sourcePart(
    { ...original, status: toMessagePartStatus(message, index, original) } as MessagePartState,
    source,
  );
  const context = source?.presentation;
  const protectedUnit = protectedPart(part, scope);
  const final =
    part.type === 'text' && !!part.text.trim() && context?.phase === 'final_answer' && context.finalEligible;
  const work = !!context && !protectedUnit && ['work', 'commentary'].includes(context.phase ?? '');
  return {
    ...scope,
    key: JSON.stringify([
      scope.rootThreadId,
      scope.ancestors,
      message.id,
      index,
      source ? sourceIdentity(source) : 'unmapped',
    ]),
    messageId: message.id,
    index,
    part,
    source,
    presentation: context,
    sourceMessageId: source?.sourceMessageId,
    sourceBlockIndex: source?.sourceBlockIndex,
    turnKey: context ? turnKey(scope, context) : undefined,
    work,
    final,
    protected: protectedUnit,
    boundary: part.type === 'text' && !part.text.trim(),
  };
}
export function messageSourceUnits(message: ThreadMessage, scope: TurnScope): SourceUnit[] {
  if (message.role !== 'assistant') return [];
  const meta = message.metadata.custom?.mainframe as MainframeMessageMeta | undefined;
  if (meta?.errorText) return [];
  return message.content.flatMap((_, index) => {
    const sources = meta?.partSources?.[index];
    return sources?.length
      ? sources.map((source) => unit(message, index, scope, source))
      : [unit(message, index, scope)];
  });
}

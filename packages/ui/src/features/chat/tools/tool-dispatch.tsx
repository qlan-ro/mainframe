'use client';

/**
 * Tool-call dispatch under MessagePrimitive.GroupedParts.
 *
 * - MessageToolLeaf resolves the per-family card from the single registry,
 *   passing the NATIVE part props (`<Card {...part} />`), falling back to the
 *   shadcn ToolFallback for any unregistered tool.
 * - MessageToolGroup renders the explore ToolGroup with the summary that was
 *   derived in the projection (carried in metadata) — no render-time re-read.
 */
import type { ReactNode } from 'react';
import type { EnrichedPartState } from '@assistant-ui/react';
import { ToolFallback } from '@/components/ui/assistant-ui/tool-fallback';
import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '@/components/ui/assistant-ui/tool-group';
import { resolveToolCard } from './registry';

type ToolCallPart = Extract<EnrichedPartState, { type: 'tool-call' }>;

export function MessageToolLeaf({ part }: { part: ToolCallPart }) {
  const Card = resolveToolCard(part.toolName) ?? ToolFallback;
  return <Card {...part} />;
}

export function MessageToolGroup({
  indices,
  running,
  summary,
  children,
}: {
  indices: readonly number[];
  running: boolean;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <ToolGroupRoot data-testid="chat-tool-group">
      <ToolGroupTrigger data-testid="chat-tool-group-toggle" count={indices.length} active={running} label={summary} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}

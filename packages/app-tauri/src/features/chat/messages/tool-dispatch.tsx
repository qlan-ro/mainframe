'use client';

/**
 * Tool-call dispatch under MessagePrimitive.GroupedParts.
 *
 * - MessageToolLeaf resolves the per-family card from the single registry,
 *   passing the NATIVE part props (`<Card {...part} />`), and falls back to the
 *   shadcn ToolFallback for any unregistered tool.
 * - MessageToolGroup renders the explore ToolGroup with a synthesized summary.
 *   The daemon never emits a group of one, so no lone-tool unwrap is needed.
 */
import type { ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type { EnrichedPartState } from '@assistant-ui/react';
import { ToolFallback } from '@/components/ui/assistant-ui/tool-fallback';
import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '@/components/ui/assistant-ui/tool-group';
import { resolveToolCard } from '../tools/registry';
import { toolGroupSummary } from '../tools/tool-group-summary';

type ToolCallPart = Extract<EnrichedPartState, { type: 'tool-call' }>;

export function MessageToolLeaf({ part }: { part: ToolCallPart }) {
  const Card = resolveToolCard(part.toolName) ?? ToolFallback;
  return <Card {...part} />;
}

export function MessageToolGroup({
  indices,
  running,
  children,
}: {
  indices: readonly number[];
  running: boolean;
  children: ReactNode;
}) {
  const parts = useAuiState((s) => s.message.parts);

  const items: { toolName: string }[] = [];
  for (const i of indices) {
    const p = parts[i];
    if (p && p.type === 'tool-call') items.push({ toolName: p.toolName });
  }

  return (
    <ToolGroupRoot data-testid="chat-tool-group">
      <ToolGroupTrigger
        data-testid="chat-tool-group-toggle"
        count={indices.length}
        active={running}
        label={toolGroupSummary(items)}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}

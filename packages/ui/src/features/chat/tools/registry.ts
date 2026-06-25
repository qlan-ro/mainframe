/**
 * The single tool-card registry: tool name → native card component.
 *
 * Replaces the desktop dual dispatcher (the `render-tool-card` switch +
 * `makeAssistantToolUI` registry). The GroupedParts dispatch resolves a card
 * here, falling back to the shadcn `ToolFallback` for any unregistered tool.
 * Cards are native `ToolCallMessagePartComponent`s and receive the full part
 * props (`<Card {...part} />`). Per-family cards are wired in via
 * `register-cards.ts` (a side-effect import) to avoid an import cycle.
 *
 * Exact-name keys only — prefix/family matches (mcp__*, the schedule set) are
 * normalized at lookup via `resolveToolCard`.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';

/** Populated by register-cards.ts as per-family cards land. */
export const TOOL_REGISTRY: Record<string, ToolCallMessagePartComponent> = {};

/**
 * Resolve a card for a tool name, applying the non-exact family rules that
 * `TOOL_REGISTRY`'s exact-name lookup can't express. Returns undefined when no
 * card matches (the dispatch then renders the shadcn ToolFallback).
 */
export function resolveToolCard(toolName: string): ToolCallMessagePartComponent | undefined {
  const exact = TOOL_REGISTRY[toolName];
  if (exact) return exact;
  // MCP tools arrive as `mcp__<server>__<tool>` — one card handles the family.
  if (toolName.startsWith('mcp__')) return TOOL_REGISTRY['_Mcp'];
  return undefined;
}

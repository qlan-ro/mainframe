/**
 * Shared type guards and interfaces for tool-card results.
 *
 * Pure logic — no React, no DOM, no side effects.
 * Ported from packages/desktop/.../tools/shared.tsx; no desktop tokens here.
 */
import type { ToolCallResult } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// TruncatedResult
// ---------------------------------------------------------------------------

export interface TruncatedResult {
  content: string;
  truncated: true;
  fullBytes: number;
}

/**
 * Returns true when the result is a structured `ToolCallResult` (i.e. has a
 * `structuredPatch` field). Used to decide whether to render a diff card.
 */
export function isStructuredResult(result: unknown): result is ToolCallResult {
  return typeof result === 'object' && result !== null && 'structuredPatch' in result;
}

/**
 * Returns true when the daemon truncated the tool output and provided a
 * `fullBytes` count so the client can offer an on-demand expand.
 */
export function isTruncatedResult(result: unknown): result is TruncatedResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'truncated' in result &&
    (result as Record<string, unknown>)['truncated'] === true
  );
}

/**
 * Strips `<tool_use_error>` and bare `<error>` XML sentinel tags injected by
 * the Claude CLI around error text. Returns the trimmed inner content.
 */
export function stripErrorXml(text: string): string {
  return text.replace(/<\/?(?:tool_use_error|error)>/g, '').trim();
}

// ---------------------------------------------------------------------------
// ToolCardProps — shared prop interface for every per-family tool card
// ---------------------------------------------------------------------------

/**
 * Props every per-family tool card receives from the assistant-ui
 * `tools.by_name` registry. `chatId` and `toolCallId` are optional because
 * the base `ToolCallMessagePartComponent` type does not include them — each
 * card that needs them reads from `useChatId()` / the message part.
 */
export interface ToolCardProps {
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
  chatId?: string;
  toolCallId?: string;
}

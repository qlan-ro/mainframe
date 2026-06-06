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

// ---------------------------------------------------------------------------
// isErrorResult / extractResultContent — shared pill-card helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the tool call resulted in an error.
 *
 * Two signal sources:
 *   1. The `isError` prop forwarded by assistant-ui (boolean flag on the part).
 *   2. The result object itself carrying `{ isError: true }` (daemon envelope).
 *
 * Either signal alone is sufficient — this mirrors what each pill card previously
 * checked inline with its own local copy.
 */
export function isErrorResult(result: unknown, isError?: boolean): boolean {
  if (isError === true) return true;
  if (typeof result === 'object' && result !== null) {
    return (result as Record<string, unknown>)['isError'] === true;
  }
  return false;
}

/**
 * Extracts a displayable string from an opaque tool-call result.
 *
 * Resolution ladder:
 *   1. `result` is a string                          → return it directly.
 *   2. `result` is an object with a string `.content` → return `.content`.
 *   3. Anything else (undefined, null, other object)  → return `''`.
 *
 * Callers that need JSON.stringify for a verbose body section should do so
 * themselves — this helper is for the compact pill label / short display text.
 */
export function extractResultContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null) {
    const content = (result as Record<string, unknown>)['content'];
    if (typeof content === 'string') return content;
  }
  return '';
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
// resolveResultText — centralized 3-way result ladder
// ---------------------------------------------------------------------------

export interface ResolvedResult {
  /** Cleaned display text (stripErrorXml applied). Empty string when no result yet. */
  text: string;
  /** True when the daemon truncated the output and provided a fullBytes count. */
  truncated: boolean;
  /** Full byte count if truncated, 0 otherwise. */
  fullBytes: number;
}

/**
 * Centralises the three-way result ladder that every tool card repeats:
 *   1. ToolCallResult (has .content + structuredPatch) → use .content
 *   2. TruncatedResult (has .truncated + .fullBytes)   → use .content
 *   3. plain string                                    → use as-is
 *   4. other object / undefined                        → JSON.stringify / ''
 *
 * stripErrorXml is always applied to the raw text before returning.
 */
export function resolveResultText(result: unknown): ResolvedResult {
  if (isStructuredResult(result)) {
    return { text: stripErrorXml(result.content), truncated: false, fullBytes: 0 };
  }
  if (isTruncatedResult(result)) {
    return { text: stripErrorXml(result.content), truncated: true, fullBytes: result.fullBytes };
  }
  if (typeof result === 'string') {
    return { text: stripErrorXml(result), truncated: false, fullBytes: 0 };
  }
  if (result !== undefined && result !== null) {
    return { text: JSON.stringify(result, null, 2), truncated: false, fullBytes: 0 };
  }
  return { text: '', truncated: false, fullBytes: 0 };
}

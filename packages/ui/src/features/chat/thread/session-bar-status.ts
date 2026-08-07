/**
 * Context-usage derivation for the session panel's rail ring and Summary row.
 * It fed the ChatCardHeader's inline 8-cell meter until the right-sidebar
 * revamp removed that third indicator of one number.
 */
import type { ChatThreadState } from '../controller/chat-thread-state';

/**
 * Context-usage percentage. Prefers the CLI-reported usage
 * (daemon `chat.contextUsage`); falls back to a token estimate only when the
 * model's context window is known — otherwise the bar would be a guess
 * against a default that may not match the real model (desktop rule).
 */
export function deriveContextPct(state: ChatThreadState, contextWindow: number | undefined): number | null {
  if (state.contextUsage != null) return Math.min(100, Math.round(state.contextUsage.percentage));
  const tokens = state.chatConfig?.lastContextTokensInput ?? 0;
  if (contextWindow == null || contextWindow <= 0) return null;
  return Math.min(100, Math.round((tokens / contextWindow) * 100));
}

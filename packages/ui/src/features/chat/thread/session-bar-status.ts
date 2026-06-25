/**
 * Pure derivations for the ChatSessionBar (design `03-content.jsx` ChatSessionBar,
 * behavior parity with desktop `ChatSessionBar.tsx`).
 *
 * Status priority mirrors desktop's StatusIndicator: a missing worktree beats
 * everything (the chat is unusable), a pending permission beats run-progress
 * (the user must act), compaction beats the generic spinner, then running,
 * then error. Idle renders nothing.
 */
import type { ChatThreadState } from '../controller/chat-thread-state';

export type SessionBarStatus = 'worktree-missing' | 'awaiting' | 'compacting' | 'thinking' | 'error' | null;

export function deriveSessionBarStatus(state: ChatThreadState): SessionBarStatus {
  if (state.chatConfig?.worktreeMissing) return 'worktree-missing';
  if (Object.keys(state.interactions.permissions).length > 0) return 'awaiting';
  if (state.compacting) return 'compacting';
  // 'cancelling' still shows the spinner — the CLI is winding down, not idle.
  if (state.runState.type === 'running' || state.runState.type === 'cancelling') return 'thinking';
  if (state.runState.type === 'error') return 'error';
  return null;
}

/**
 * Context-usage percentage for the meter. Prefers the CLI-reported usage
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

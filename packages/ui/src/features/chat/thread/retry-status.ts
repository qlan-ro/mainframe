/**
 * The reconnect status shown while the provider retries a call (todo #406):
 * its label, its test id, and the hook that reads it for a host that is not the
 * turn status row (a live activity header's trailing slot).
 */
import { useChatExtras } from '../runtime/chat-extras';
import { outranksReconnect } from './turn-phase';

export interface RetryStatus {
  readonly attempt: number;
  readonly maxAttempts?: number;
}

/** Codex's own per-transport numbers; never summed. An unknown attempt (below 1) shows none. */
export function retryStatusLabel(retry: RetryStatus): string {
  if (retry.attempt < 1) return 'Reconnecting…';
  return retry.maxAttempts === undefined
    ? `Reconnecting (${retry.attempt})…`
    : `Reconnecting (${retry.attempt}/${retry.maxAttempts})…`;
}

export const retryStatusTestId = (chatId: string): string => `chat-retry-status-${chatId}`;

/** True for a displayed phase text that is the reconnect label. */
export const isReconnectText = (text: string): boolean => text.startsWith('Reconnecting');

/** The pending retry's label, or null when none is pending. Ignores the turn-phase priority. */
export function useRetryLabel(): string | null {
  const retry = useChatExtras()?.state.retry;
  return retry ? retryStatusLabel(retry) : null;
}

/** The label a hosting header's trailing slot shows: null while Stopping, Needs your input or Compacting outrank it. */
export function useHostedRetryLabel(): { label: string; testId: string } | null {
  const extras = useChatExtras();
  const retry = extras?.state.retry;
  if (!extras || !retry) return null;
  const outranked = outranksReconnect({
    stopping: extras.state.runState.type === 'cancelling',
    compacting: extras.state.compacting,
    awaitingInput: Object.keys(extras.permissions ?? {}).length > 0,
  });
  return outranked ? null : { label: retryStatusLabel(retry), testId: retryStatusTestId(extras.state.chatId) };
}

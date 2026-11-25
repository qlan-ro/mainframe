/** The reconnect status shown while the provider retries a call (todo #406): its label and its test id. */
import { useChatExtras } from '../runtime/chat-extras';

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

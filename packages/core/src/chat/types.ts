import type { Chat, AdapterSession } from '@qlan-ro/mainframe-types';

export interface ActiveChat {
  chat: Chat;
  session: AdapterSession | null;
  /** `Date.now()` at the moment the current turn was dispatched to the CLI; read back in `onResult` to compute `turnDurationMs`. */
  turnStartedAt?: number;
}

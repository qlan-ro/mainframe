import type { Chat, AdapterSession } from '@qlan-ro/mainframe-types';

export interface ActiveChat {
  chat: Chat;
  session: AdapterSession | null;
}

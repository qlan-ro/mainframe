import type { Chat, AdapterSession } from '@mainframe/types';

export interface ActiveChat {
  chat: Chat;
  session: AdapterSession | null;
}

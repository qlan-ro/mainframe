import type { Chat, AdapterProcess } from '@mainframe/types';

export interface ActiveChat {
  chat: Chat;
  process: AdapterProcess | null;
}

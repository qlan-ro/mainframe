/**
 * Session-context REST wrapper — GET /api/chats/:id/context.
 */
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getSessionContext = (port: number, chatId: string): Promise<SessionContext> =>
  request<SessionContext>('GET', `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/context`);

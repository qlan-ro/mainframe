/**
 * Pure rules and copy for switching a chat's provider in place. The daemon's
 * refusal table (`segments/switch_rules.rs`) is authoritative; this mirrors
 * the rows the UI can see so the provider tabs are disabled with the same
 * copy before a request is ever made.
 */
import type { Chat } from '@qlan-ro/mainframe-types';

/** Why the non-active provider tabs are disabled, or null when switching is open. */
export function providerSwitchBlockedReason(chat: Chat, queuedCount: number, fromName: string): string | null {
  if (chat.temporary && chat.parentChatId) return "Side chats keep their parent's provider";
  if (chat.temporary) return "Temporary chats can't switch providers";
  if (chat.processState === 'working' || chat.displayStatus === 'waiting') {
    return 'Wait for the current turn to finish or interrupt it';
  }
  if (queuedCount > 0) return 'Send or cancel queued messages before switching providers';
  if ((chat.backgroundActivity?.total ?? 0) > 0) {
    return `${fromName} is still running background agents or commands, and switching would end them. Wait for them to finish, or press Stop, then switch.`;
  }
  return null;
}

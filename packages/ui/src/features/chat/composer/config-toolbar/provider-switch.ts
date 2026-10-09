/**
 * Pure rules and copy for switching a chat's provider in place. The daemon's
 * refusal table (`segments/switch_rules.rs`) is authoritative; this mirrors
 * the rows the UI can see so the provider tabs are disabled with the same
 * copy before a request is ever made.
 */
import type { Chat, ChatSegment } from '@qlan-ro/mainframe-types';

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

/** Whether `adapterId` already ran a resumable session in this chat. */
export function hasEarlierSession(segments: readonly ChatSegment[], adapterId: string): boolean {
  return segments.some((s) => s.adapterId === adapterId && s.nativeSessionId != null && !s.borrowed);
}

export interface ProviderSwitchCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

export function describeProviderSwitch(from: string, to: string, returning: boolean): ProviderSwitchCopy {
  if (returning) {
    return {
      title: `Go back to ${to}?`,
      body: `${from}'s session stops here. ${to} resumes its earlier session in this chat and gets what happened since, with your next message.`,
      confirmLabel: `Switch to ${to}`,
    };
  }
  return {
    title: `Continue this chat in ${to}?`,
    body: `${from}'s session stops here. Your next message goes to ${to}, along with up to ~16k tokens of this chat's history, so it can pick up where ${from} left off.`,
    confirmLabel: `Switch to ${to}`,
  };
}

export const PROVIDER_SWITCH_FOOTER =
  'Switching keeps this chat. The new provider gets its history with your next message.';
export const PROVIDER_PICK_FOOTER = 'Pick a provider before your first message.';

/**
 * side-chat-ids — side-chat identity and a runtime registry mapping a side
 * chat's id to its parent chat id (todo #344).
 *
 * The server never lists a side chat (AC 5), so aui's thread list — and every
 * store that projects from it (tabs, zones) — never learns of one on its own.
 * `isSideChat` is the pure identity check over a `Chat`/`SessionCustom`-shaped
 * value; the registry below is how a caller holding only an ID (a store guard,
 * a WS event, a stale toast) can still recognize one. Entries come from two
 * places: `useOpenSideChat` registers the pair the moment it opens one, and
 * `recordSideChatsFromList` scans a list/fetch response for the parent's own
 * `sideChatId` field on every reload — the desktop already reloads on every
 * `chat.created`/`chat.ended`/`chat.updated` (see the plan's Established
 * facts), so the registry never goes stale for long.
 *
 * Module-level, not a zustand store: every consumer (store guards called from
 * outside React, the WS router) needs a synchronous, hook-free read.
 */
import type { Chat } from '@qlan-ro/mainframe-types';

interface SideChatIdentity {
  temporary: boolean;
  parentChatId?: string | null;
}

/** A side chat is exactly "temporary and has a parent" — no third concept. */
export function isSideChat(chat: SideChatIdentity): boolean {
  return chat.temporary && chat.parentChatId != null;
}

const parentBySideChatId = new Map<string, string>();

export function registerSideChat(sideChatId: string, parentChatId: string): void {
  parentBySideChatId.set(sideChatId, parentChatId);
}

export function unregisterSideChat(sideChatId: string): void {
  parentBySideChatId.delete(sideChatId);
}

export function isRegisteredSideChatId(id: string): boolean {
  return parentBySideChatId.has(id);
}

export function parentOfSideChat(id: string): string | undefined {
  return parentBySideChatId.get(id);
}

/**
 * Record every parent → side-chat mapping visible in a batch of chats (a list
 * reload or a single fetch). A parent that no longer reports a `sideChatId`
 * (discarded) is left registered until an explicit `unregisterSideChat` —
 * discard call sites own clearing it, since a stale mapping is harmless (the
 * guards it feeds only ever refuse an id, never act on it) while a
 * prematurely cleared one would let a guard miss the id.
 */
export function recordSideChatsFromList(chats: readonly Chat[]): void {
  for (const chat of chats) {
    if (chat.sideChatId != null) registerSideChat(chat.sideChatId, chat.id);
  }
}

/** Test-only: clear all registered mappings so tests don't leak state. */
export function __resetSideChatRegistryForTests(): void {
  parentBySideChatId.clear();
}

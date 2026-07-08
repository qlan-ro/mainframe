import type { SessionItem } from './chat-to-thread-custom';

export function isSessionUnread(item: SessionItem, unread: Set<string>): boolean {
  return unread.has(item.id) || (item.remoteId != null && unread.has(item.remoteId));
}

export function isSessionUnreadById(item: SessionItem, isUnread: (id: string) => boolean): boolean {
  return isUnread(item.id) || (item.remoteId != null && isUnread(item.remoteId));
}

import type { ChatPermissionEntry } from '../controller/chat-thread-state';

/** Queue-front gate: pending entries sorted by askedAt asc, take the first. */
export function selectPermissionFront(
  permissions: Readonly<Record<string, ChatPermissionEntry>> | undefined,
): ChatPermissionEntry | undefined {
  if (!permissions) return undefined;
  const pending = Object.values(permissions).filter((e): e is ChatPermissionEntry => e != null);
  return [...pending].sort((a, b) => a.askedAt - b.askedAt)[0];
}

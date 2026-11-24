/**
 * Which side chats already had their tab opened for them, per session
 * (`useSideChatTab`). A side chat opens by itself once: after that its tab is the
 * user's to close and reopen, and the workspace layout remembers it.
 *
 * Upgrade from the side-chat panel: `mf:side-chat-collapsed:<parent>` said the
 * user had folded the panel away. Such a side chat starts closed and stays a
 * click away; one that was showing (no key, or `false`) opens as a tab.
 */
const KEY = 'mf:side-chat-tabs';
const COLLAPSED_PREFIX = 'mf:side-chat-collapsed:';
/** Old pairs fall off the front; losing one only means its tab opens by itself again. */
const MAX_PAIRS = 500;

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    /* expected: unavailable or corrupt storage reads as nothing opened yet */
    return [];
  }
}

const pairKey = (sessionId: string, sideChatId: string): string => `${sessionId}:${sideChatId}`;

/** The old panel's fold belongs to the side chat itself, so it holds in every session that shows it. */
const FOLDED = '*';

/** True the first time it is asked about a side chat in a session, unless the old panel was folded away. */
export function claimFirstOpen(sessionId: string, sideChatId: string, parentChatId: string): boolean {
  const pairs = read();
  const key = pairKey(sessionId, sideChatId);
  const foldedKey = pairKey(FOLDED, sideChatId);
  if (pairs.includes(key) || pairs.includes(foldedKey)) return false;
  let folded = false;
  try {
    const legacyKey = `${COLLAPSED_PREFIX}${parentChatId}`;
    folded = localStorage.getItem(legacyKey) === 'true';
    localStorage.setItem(KEY, JSON.stringify([...pairs, folded ? foldedKey : key].slice(-MAX_PAIRS)));
    localStorage.removeItem(legacyKey);
  } catch {
    /* expected: with no storage the choice lasts for this call only */
  }
  return !folded;
}

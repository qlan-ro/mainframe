/**
 * Boot prewarm — ask the daemon for the last-open chat the moment it is
 * reachable, instead of after the session list has loaded and the router has
 * picked a chat to open.
 *
 * The chat to open is almost always the persisted `lastSessionId`. Waiting for
 * the list put the history request ~75 ms behind the first request the page
 * makes, and the daemon spends the next ~250 ms loading that history. So boot
 * attaches the controller for the remembered id right away, exactly as
 * selecting it would (side-band subscribe, which starts the daemon's history
 * load, plus the facade plane through a hold).
 *
 * A guess, so it is settled once the list has answered:
 * - the router opened that chat: `handOverBootPrewarm` releases the guess when
 *   the selection takes its own holds, so the plane never detaches in between;
 * - the router opened another chat, or none (deleted, archived, empty list,
 *   list failed): `settleBootPrewarm` releases the guess, and drops the
 *   controller when the chat is not in the list any more and no other view
 *   holds it;
 * - nothing settles it: it releases itself after `EXPIRY_MS`.
 */
import { useLastSessionStore } from '@/store/last-session';
import { chatControllerRegistry } from './chat-controller-registry';

const EXPIRY_MS = 15_000;

interface Guess {
  chatId: string;
  controller: { isInUse(): boolean };
  release: () => void;
}

let current: Guess | null = null;

function stopGuess(): Guess | null {
  const guess = current;
  current = null;
  guess?.release();
  return guess;
}

/** Idempotent. A no-op on a first run (nothing remembered) or while a guess is live. */
export function startBootChatPrewarm(
  port: number,
  chatId: string | null = useLastSessionStore.getState().lastSessionId,
): void {
  if (current || chatId == null || chatId.startsWith('__LOCALID_')) return;
  const controller = chatControllerRegistry.getOrCreate(chatId, port);
  const stopLive = controller.subscribeLive();
  const stopActive = controller.holdActive();
  const timer = setTimeout(() => {
    if (current === guess) stopGuess();
  }, EXPIRY_MS);
  const release = () => {
    clearTimeout(timer);
    stopLive();
    stopActive();
  };
  const guess: Guess = { chatId, controller, release };
  current = guess;
}

/** The selection now holds `controller` itself; the guess has nothing left to keep alive. */
export function handOverBootPrewarm(controller: object): void {
  if (current?.controller === controller) stopGuess();
}

/**
 * The router has decided. `keepChatId` is the daemon id of the chat it opened
 * (null for none); `listedChatIds` are the live, non-archived chats of the list.
 */
export function settleBootPrewarm(keepChatId: string | null, listedChatIds: ReadonlySet<string>): void {
  if (!current || current.chatId === keepChatId) return;
  const guess = stopGuess();
  // A restored workspace tab may hold the chat even when the list does not show it as a session.
  if (guess && !listedChatIds.has(guess.chatId) && !guess.controller.isInUse()) {
    chatControllerRegistry.dispose(guess.chatId);
  }
}

/** A daemon switch drops the controllers; drop the guess with them. */
export function resetBootPrewarm(): void {
  try {
    stopGuess();
  } catch (err) {
    console.warn('[boot-prewarm] release failed', err);
  }
}

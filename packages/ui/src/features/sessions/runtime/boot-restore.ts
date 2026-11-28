/**
 * Boot restore hold — the app shows its frame, not its guesses, while it works
 * out which chat to reopen.
 *
 * At launch the shell mounts before the session list has loaded. Everything it
 * draws in that gap is a guess: the New Session welcome, a "New Session" tab,
 * "No sessions yet", a layout built for a draft, a transcript still arriving.
 * The remembered chat then replaces all of it, one piece at a time.
 *
 * So the app holds: from the first healthy `/health` until the restore is
 * decided and, when there is a chat to reopen, until its first history window
 * is in. The shell stays mounted (its layout and effects run as usual) but its
 * session surfaces are not painted, so nothing shows until the final picture.
 *
 * - `beginBootRestore` starts the hold (once per page load; a daemon switch is
 *   not a boot) with a deadline, so a slow or failed load never leaves the app
 *   blank: past `BOOT_HOLD_MAX_MS` it shows whatever it has.
 * - `decideBootRestore(chatId)` is called by the boot auto-select once the list
 *   has answered: `null` when there is nothing to reopen (the welcome is then
 *   the right screen), else the daemon id of the chat that was opened. The hold
 *   then ends on the first frame the chat's rows are shown at the tail of the
 *   transcript.
 */
import { create } from 'zustand';
import { chatControllerRegistry } from './chat-controller-registry';

/** The longest the app waits for the restore before it shows what it has. A running turn never holds past it. */
export const BOOT_HOLD_MAX_MS = 1500;
/** An empty chat (its list says it holds no messages) is shown once its transcript has been mounted this long. */
const SETTLE_MS = 48;
/** Within this many px of the end counts as the tail. */
const TAIL_SLOP_PX = 2;

type Phase = 'idle' | 'holding' | 'released';

interface BootRestoreState {
  phase: Phase;
}

export const useBootRestore = create<BootRestoreState>(() => ({ phase: 'idle' }));

let deadline: ReturnType<typeof setTimeout> | undefined;
let watch: number | undefined;
let startedAt = 0;

function stopWatching(): void {
  if (watch !== undefined) cancelAnimationFrame(watch);
  watch = undefined;
}

function release(): void {
  clearTimeout(deadline);
  deadline = undefined;
  stopWatching();
  if (useBootRestore.getState().phase === 'holding') useBootRestore.setState({ phase: 'released' });
}

/** Starts the hold. Idempotent: only the first call of a page load takes effect. */
export function beginBootRestore(): void {
  if (useBootRestore.getState().phase !== 'idle') return;
  startedAt = performance.now();
  useBootRestore.setState({ phase: 'holding' });
  deadline = setTimeout(release, BOOT_HOLD_MAX_MS);
}

/** How long the hold has lasted: the cover's spinner counts its delay from the hold's start, not its own mount. */
export function bootHoldElapsedMs(): number {
  return useBootRestore.getState().phase === 'holding' ? performance.now() - startedAt : 0;
}

/** Whether the boot restore is still pending: session surfaces stay unpainted. */
export function isBootRestoring(): boolean {
  return useBootRestore.getState().phase === 'holding';
}

export function useBootRestoring(): boolean {
  return useBootRestore((s) => s.phase === 'holding');
}

function chatLoaded(chatId: string): boolean {
  const type = chatControllerRegistry.get(chatId)?.getState().loadState.type;
  return type === 'ready' || type === 'error';
}

/** Every transcript in the chat column (the conversation's own, never a workspace tab's side chat). */
function mainTranscripts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-surface="chat"] [data-mf-chat-thread]')];
}

/** No chat column at all: nothing on screen to settle. A mounted column with no transcript (initializing, the first-run hero) is not that. */
function chatColumnUnmounted(): boolean {
  return document.querySelector('[data-surface="chat"]') == null;
}

function atTail(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - TAIL_SLOP_PX;
}

/**
 * What the transcript's message list shows. Both lists render `chat-message-list` with
 * `data-loaded-count`. The default list keeps itself `visibility:hidden` until it has measured
 * and pinned its rows, and commits its first rows a frame after it measures; the plain list
 * fills the viewport with its newest rows before its first paint and marks `data-rows-pending`
 * while older rows of the first window are still to mount above them.
 *
 * - `empty`: the list says it holds no messages (an empty chat): nothing more will arrive.
 * - `pending`: messages are loaded but no row is drawn yet, the list is not mounted, or it is
 *   hidden: what it will show is not on screen yet.
 * - `underfilled`: rows are shown but do not fill the viewport while more are still to mount.
 * - `shown`: rows are shown.
 */
function listState(el: HTMLElement): 'empty' | 'pending' | 'underfilled' | 'shown' {
  const list = el.querySelector<HTMLElement>('[data-testid="chat-message-list"]');
  const row = el.querySelector('[data-message-id]');
  if (row == null) return list?.getAttribute('data-loaded-count') === '0' ? 'empty' : 'pending';
  if (getComputedStyle(list ?? (row as HTMLElement)).visibility === 'hidden') return 'pending';
  if (list?.hasAttribute('data-rows-pending') && el.scrollHeight <= el.clientHeight) return 'underfilled';
  return 'shown';
}

/**
 * The router has decided what to open. With nothing to open the hold ends at
 * once. Otherwise it ends on the first frame where the chat's history is in, its
 * transcript is mounted in the chat column, its rows are shown and it sits at
 * the tail. The check runs in an animation frame, before that frame paints, so
 * the cover lifts in the very frame the pinned transcript is first drawn: no
 * earlier frame can show it half-scrolled or still hidden, and no later one is
 * spent covering a finished picture. The default (virtualized) list must also
 * keep its height across two frames: it can reveal with an estimated row
 * height and correct it a frame later, moving the rows (146 px on a Codex
 * chat in WebKit). An empty chat (its list reports no
 * messages) is shown once its transcript has been mounted `SETTLE_MS`; a list
 * with messages but no row drawn yet keeps the hold. A turn still streaming
 * does not matter: the tail is only checked, never waited to go quiet.
 *
 * Until the chat column shows THIS chat's transcript the hold keeps waiting:
 * assistant-ui switches threads asynchronously, and for a moment the column
 * still holds the draft welcome, and "Initializing session…" and the first-run
 * hero are a mounted column with no transcript. Only an unmounted column has
 * nothing to settle; anything else runs to the deadline.
 */
export function decideBootRestore(chatId: string | null): void {
  if (!isBootRestoring()) return;
  if (chatId == null) {
    release();
    return;
  }
  stopWatching();
  let loadedAt = 0;
  let mountedAt = 0;
  let lastHeight = -1;
  /** `inFrame`: called from an animation frame, where a height counts towards the two-frame check. */
  const settled = (inFrame: boolean): boolean => {
    if (!chatLoaded(chatId)) return false;
    const now = performance.now();
    loadedAt ||= now;
    const mine = mainTranscripts().find((el) => el.getAttribute('data-mf-chat-id') === chatId);
    if (mine == null) return chatColumnUnmounted() && now - loadedAt >= SETTLE_MS;
    // The settle window starts when THIS transcript is first seen, not when the chat
    // reported ready: the boot prewarm can be ready long before the thread switch lands.
    mountedAt ||= now;
    const state = listState(mine);
    if (state === 'empty') return now - mountedAt >= SETTLE_MS;
    if (state !== 'shown' || !atTail(mine)) {
      lastHeight = -1;
      return false;
    }
    if (mine.querySelector('[data-virtualized="true"]') == null) return true;
    if (!inFrame) return false;
    const steady = mine.scrollHeight === lastHeight;
    lastHeight = mine.scrollHeight;
    return steady;
  };
  const frame = () => {
    watch = undefined;
    if (!isBootRestoring()) return;
    if (settled(true)) return release();
    watch = requestAnimationFrame(frame);
  };
  if (settled(false)) return release();
  watch = requestAnimationFrame(frame);
}

/** Test seam: a fresh page load. */
export function resetBootRestore(): void {
  clearTimeout(deadline);
  deadline = undefined;
  stopWatching();
  startedAt = 0;
  useBootRestore.setState({ phase: 'idle' });
}

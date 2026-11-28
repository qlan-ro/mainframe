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
/** A chat with no rows on screen (nothing to settle) is shown this long after it reports ready. */
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
 * Whether the transcript has rows and shows them. The default list keeps its rows
 * `visibility:hidden` until it has measured and pinned them; the plain list fills the
 * viewport with its newest rows before its first paint. Layout-free on purpose.
 */
function rowsState(el: HTMLElement): 'none' | 'hidden' | 'shown' {
  const row = el.querySelector('[data-message-id]');
  if (row == null) return 'none';
  const list = row.closest<HTMLElement>('[data-testid="chat-message-list"]') ?? row;
  return getComputedStyle(list).visibility === 'hidden' ? 'hidden' : 'shown';
}

/**
 * The router has decided what to open. With nothing to open the hold ends at
 * once. Otherwise it ends on the first frame where the chat's history is in, its
 * transcript is mounted in the chat column, its rows are shown and it sits at
 * the tail. The check runs in an animation frame, before that frame paints, so
 * the cover lifts in the very frame the pinned transcript is first drawn: no
 * earlier frame can show it half-scrolled or still hidden, and no later one is
 * spent covering a finished picture. A transcript with no rows (an empty chat)
 * is shown `SETTLE_MS` after the chat is ready. A turn still streaming does not
 * matter: the tail is only checked, never waited to go quiet.
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
  const settled = (): boolean => {
    if (!chatLoaded(chatId)) return false;
    loadedAt ||= performance.now();
    const waited = performance.now() - loadedAt >= SETTLE_MS;
    const mine = mainTranscripts().find((el) => el.getAttribute('data-mf-chat-id') === chatId);
    if (mine == null) return chatColumnUnmounted() && waited;
    const rows = rowsState(mine);
    return atTail(mine) && (rows === 'shown' || (rows === 'none' && waited));
  };
  const frame = () => {
    watch = undefined;
    if (!isBootRestoring()) return;
    if (settled()) return release();
    watch = requestAnimationFrame(frame);
  };
  if (settled()) return release();
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

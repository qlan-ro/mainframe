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
 *   then ends when the chat's history is in and its first pin has landed at the
 *   tail of the transcript.
 */
import { create } from 'zustand';
import { chatControllerRegistry } from './chat-controller-registry';

/** The longest the app waits for the restore before it shows what it has. A running turn never holds past it. */
export const BOOT_HOLD_MAX_MS = 1500;
/** A chat with no transcript on screen (nothing to settle) is shown this long after it reports ready. */
const SETTLE_MS = 48;
/** The first pin has landed once the main transcript has sat at its tail for this many polls in a row. */
const TAIL_POLLS = 3;
/** Within this many px of the end counts as the tail. */
const TAIL_SLOP_PX = 2;
const POLL_MS = 16;

type Phase = 'idle' | 'holding' | 'released';

interface BootRestoreState {
  phase: Phase;
}

export const useBootRestore = create<BootRestoreState>(() => ({ phase: 'idle' }));

let deadline: ReturnType<typeof setTimeout> | undefined;
let watch: ReturnType<typeof setTimeout> | undefined;

function release(): void {
  clearTimeout(deadline);
  clearTimeout(watch);
  deadline = undefined;
  watch = undefined;
  if (useBootRestore.getState().phase === 'holding') useBootRestore.setState({ phase: 'released' });
}

/** Starts the hold. Idempotent: only the first call of a page load takes effect. */
export function beginBootRestore(): void {
  if (useBootRestore.getState().phase !== 'idle') return;
  useBootRestore.setState({ phase: 'holding' });
  deadline = setTimeout(release, BOOT_HOLD_MAX_MS);
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

function atTail(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - TAIL_SLOP_PX;
}

/**
 * The router has decided what to open. With nothing to open the hold ends at
 * once. Otherwise it ends when the chat's history is in, its transcript is
 * mounted in the chat column, and the first pin has landed at its tail: the
 * window arrives in pieces and the thread pins a few frames behind, so earlier
 * would draw it half-scrolled. A turn still streaming does not matter: the
 * tail is only checked, never waited to go quiet.
 *
 * Until the chat column shows THIS chat's transcript the hold keeps waiting:
 * assistant-ui switches threads asynchronously, and for a moment the column
 * still holds the draft welcome. Only a column with no transcript at all has
 * nothing to settle.
 */
export function decideBootRestore(chatId: string | null): void {
  if (!isBootRestoring()) return;
  if (chatId == null) {
    release();
    return;
  }
  clearTimeout(watch);
  let loadedAt = 0;
  let atTailPolls = 0;
  const poll = () => {
    if (!isBootRestoring()) return;
    if (chatLoaded(chatId)) {
      loadedAt ||= Date.now();
      const column = mainTranscripts();
      const mine = column.find((el) => el.getAttribute('data-mf-chat-id') === chatId);
      if (mine != null) {
        atTailPolls = atTail(mine) ? atTailPolls + 1 : 0;
        if (atTailPolls >= TAIL_POLLS) return release();
      } else if (column.length === 0 && Date.now() - loadedAt >= SETTLE_MS) {
        return release();
      }
    }
    watch = setTimeout(poll, POLL_MS);
  };
  poll();
}

/** Test seam: a fresh page load. */
export function resetBootRestore(): void {
  clearTimeout(deadline);
  clearTimeout(watch);
  deadline = undefined;
  watch = undefined;
  useBootRestore.setState({ phase: 'idle' });
}

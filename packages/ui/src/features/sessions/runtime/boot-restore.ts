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
 *   then ends when the chat's history is in and its transcript has stopped
 *   moving: the window arrives in pieces, and the thread pins itself to the end
 *   a few frames behind, so showing it earlier draws it half-scrolled.
 */
import { create } from 'zustand';
import { chatControllerRegistry } from './chat-controller-registry';

/** The longest the app waits for the restore before it shows what it has. */
export const BOOT_HOLD_MAX_MS = 2500;
/** A chat with no transcript on screen (nothing to settle) is shown this long after it reports ready. */
const SETTLE_MS = 48;
/** The transcript has settled once its scroll size and offset have not moved for this long. */
const STABLE_MS = 96;
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

/** The chat's main transcript viewport, once it is mounted. Laid out even while not painted. */
function transcriptOf(chatId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-mf-chat-thread][data-mf-chat-id="${CSS.escape(chatId)}"]`);
}

/**
 * The transcript's scroll size and offset: while either still changes, rows are
 * arriving or the thread is still pinning to the end.
 */
export function transcriptSignature(el: HTMLElement): string {
  return `${el.scrollHeight}:${Math.round(el.scrollTop)}`;
}

/** A history spinner anywhere in the shell (a restored side chat still loading): a transcript not there yet. */
function historyStillLoading(): boolean {
  return document.querySelector('[data-testid="chat-thread-loading"]') != null;
}

/**
 * The router has decided what to open. With nothing to open the hold ends at
 * once; otherwise it ends when the chat's history is in and its transcript has
 * stopped moving.
 */
export function decideBootRestore(chatId: string | null): void {
  if (!isBootRestoring()) return;
  if (chatId == null) {
    release();
    return;
  }
  clearTimeout(watch);
  let loadedAt = 0;
  let signature = '';
  let stableSince = 0;
  const poll = () => {
    if (!isBootRestoring()) return;
    const now = Date.now();
    if (chatLoaded(chatId)) {
      loadedAt ||= now;
      const el = transcriptOf(chatId);
      if (el == null) {
        if (now - loadedAt >= SETTLE_MS) return release();
      } else {
        const next = transcriptSignature(el);
        if (next !== signature || historyStillLoading()) {
          signature = next;
          stableSince = now;
        } else if (now - stableSince >= STABLE_MS) {
          return release();
        }
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

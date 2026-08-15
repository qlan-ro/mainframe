/**
 * The reveal state behind the ⌘1…⌘9 tab hints.
 *
 * `sessions.tab-by-index` is the one entry whose target the chord cannot
 * name: ⌘4 means nothing until you know which tab is fourth. Holding the
 * modifier answers that on the tabs themselves, so the binding is learned
 * where it is used rather than in the cheat sheet (issue #374).
 *
 * Lives beside `cheat-sheet-store` in the core group for the same reason it
 * does: the surfaces that paint badges read this store, never the reverse.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { isMacPlatform } from './platform';

/**
 * ⌘ leads nearly every chord in the app, so this delay is what keeps ⌘N, ⌘O and
 * ⌘F from flashing the badges on their way past — long enough to sit out a
 * deliberate chord, short enough to read as a reveal rather than a wait.
 */
export const INDEX_HINT_DELAY_MS = 350;

interface IndexHintsStore {
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
}

export const useIndexHintsStore = create<IndexHintsStore>((set) => ({
  revealed: false,
  setRevealed: (revealed) => set({ revealed }),
}));

/**
 * The modifier `sessions.tab-by-index` binds — the `mod` key, so ⌘ on macOS
 * and Ctrl elsewhere. Takes the flags rather than the event so tests need no
 * KeyboardEvent.
 */
export function hintModifierHeld(flags: { metaKey: boolean; ctrlKey: boolean }, isMac: boolean): boolean {
  return isMac ? flags.metaKey : flags.ctrlKey;
}

/**
 * Installs the hold-to-reveal listeners. Mounted once, beside the dispatcher —
 * two mounts would arm two timers against one store.
 */
export function useIndexHintReveal(): void {
  useEffect(() => {
    const isMac = isMacPlatform();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const hide = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (useIndexHintsStore.getState().revealed) useIndexHintsStore.getState().setRevealed(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!hintModifierHeld(event, isMac)) {
        hide();
        return;
      }
      // Holding a modifier repeats keydown; re-arming on every repeat would
      // push the reveal permanently into the future.
      if (timer !== null || useIndexHintsStore.getState().revealed) return;
      timer = setTimeout(() => {
        timer = null;
        useIndexHintsStore.getState().setRevealed(true);
      }, INDEX_HINT_DELAY_MS);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!hintModifierHeld(event, isMac)) hide();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // ⌘⇥ and any chord that moves focus out of the window swallow the keyup,
    // which would otherwise leave the badges painted over every tab.
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', hide);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}

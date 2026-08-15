/**
 * The cheat sheet's open state. Lives in the core group, not with the
 * dialog, so ⌘/'s action can be registered without waiting on the dialog
 * component — the dialog reads this store, never the other way round.
 */
import { create } from 'zustand';

interface CheatSheetStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCheatSheetStore = create<CheatSheetStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const OTHER_MODAL_SELECTOR = '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]';

/**
 * Open → close. Closed with another modal already rendered (facts 8/9) →
 * stand down rather than stack dialogs. Closed with nothing else open →
 * open.
 */
export function toggleCheatSheet(): void {
  const { open, setOpen } = useCheatSheetStore.getState();
  if (open) {
    setOpen(false);
    return;
  }
  if (document.querySelector(OTHER_MODAL_SELECTOR) != null) return;
  setOpen(true);
}

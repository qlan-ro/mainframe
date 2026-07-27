/**
 * use-setup-advisor — zustand nav store for the Setup Advisor sheet.
 *
 * Mirrors `features/tasks/use-tasks-modal.ts`: a bare open/close flag, no
 * reach-through into the data store. `SetupAdvisorHost` reacts to `open` to
 * drive the fetch.
 */
import { create } from 'zustand';

interface SetupAdvisorNavState {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useSetupAdvisor = create<SetupAdvisorNavState>((set) => ({
  open: false,
  openSheet: () => set({ open: true }),
  closeSheet: () => set({ open: false }),
}));

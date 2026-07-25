/**
 * use-setup-advisor — zustand nav store for the Setup Advisor sheet.
 *
 * Mirrors `features/tasks/use-tasks-modal.ts`: a bare open/close flag, no
 * reach-through into the data store. `SetupAdvisorHost` reacts to `open` to
 * drive the fetch. `openSeq` increments on every `openSheet()` call so a
 * close immediately followed by a re-open — which React 18 can batch into a
 * single render that never exposes the intermediate `open:false` — still
 * produces an observable change for the host's rising-edge effect.
 */
import { create } from 'zustand';

interface SetupAdvisorNavState {
  open: boolean;
  openSeq: number;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useSetupAdvisor = create<SetupAdvisorNavState>((set) => ({
  open: false,
  openSeq: 0,
  openSheet: () => set((s) => ({ open: true, openSeq: s.openSeq + 1 })),
  closeSheet: () => set({ open: false }),
}));

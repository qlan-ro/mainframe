/**
 * use-setup-advisor — zustand nav store for the Setup Advisor sheet.
 *
 * Mirrors `features/tasks/use-tasks-modal.ts`: a bare open/close flag, no
 * reach-through into the data store. `SetupAdvisorHost` reacts to `open` to
 * drive the fetch.
 *
 * The dialog hosts two sections, so the store also carries which one a caller
 * opened on. `openSheet` normalizes its argument instead of trusting it: it is
 * wired to `onClick` handlers, which hand it a MouseEvent as the first
 * argument.
 */
import { create } from 'zustand';

export type AdvisorSection = 'recommendations' | 'skills';

interface SetupAdvisorNavState {
  open: boolean;
  section: AdvisorSection;
  openSheet: (section?: AdvisorSection) => void;
  setSection: (section: AdvisorSection) => void;
  closeSheet: () => void;
}

const normalizeSection = (section: unknown): AdvisorSection => (section === 'skills' ? 'skills' : 'recommendations');

export const useSetupAdvisor = create<SetupAdvisorNavState>((set) => ({
  open: false,
  section: 'recommendations',
  openSheet: (section) => set({ open: true, section: normalizeSection(section) }),
  setSection: (section) => set({ section: normalizeSection(section) }),
  closeSheet: () => set({ open: false }),
}));

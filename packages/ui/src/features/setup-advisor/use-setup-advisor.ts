/**
 * use-setup-advisor — zustand nav store for the Setup Advisor sheet.
 *
 * Mirrors `features/tasks/use-tasks-modal.ts`: open/close plus the section the
 * sheet lands on, no reach-through into the data store. `SetupAdvisorHost`
 * reacts to `open` to drive the fetch.
 */
import { create } from 'zustand';

export type AdvisorSection = 'recommendations' | 'skills';

const SECTIONS: readonly AdvisorSection[] = ['recommendations', 'skills'];

const normalizeSection = (value: unknown): AdvisorSection =>
  typeof value === 'string' && (SECTIONS as readonly string[]).includes(value)
    ? (value as AdvisorSection)
    : 'recommendations';

interface SetupAdvisorNavState {
  open: boolean;
  section: AdvisorSection;
  /** `unknown` on purpose: `onClick={openSheet}` would otherwise land a click event as the section. */
  openSheet: (section?: unknown) => void;
  closeSheet: () => void;
  setSection: (section: AdvisorSection) => void;
}

export const useSetupAdvisor = create<SetupAdvisorNavState>((set) => ({
  open: false,
  section: 'recommendations',
  openSheet: (section) => set({ open: true, section: normalizeSection(section) }),
  closeSheet: () => set({ open: false }),
  setSection: (section) => set({ section: normalizeSection(section) }),
}));

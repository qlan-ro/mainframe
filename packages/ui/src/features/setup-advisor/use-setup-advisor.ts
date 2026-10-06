/**
 * use-setup-advisor — nav store for the Setup Advisor rail view (D8).
 *
 * The advisor is a rail view now, not a sheet: `openSheet` (name kept for
 * every existing caller — `TitleBarActions`' button is gone, but
 * `ContextSection`'s "Manage" skills link still calls it) shows the body by
 * setting `sidebarView` ('advisor') in `ui-prefs` — the shared chrome store,
 * same allowance `use-automations-nav.ts`'s `openHost` takes — and only
 * touches `section` when one was actually asked for, so a plain reopen
 * resumes where you left off instead of snapping back to Recommendations.
 */
import { create } from 'zustand';
import { useUiPrefs } from '@/store/ui-prefs';

export type AdvisorSection = 'recommendations' | 'skills';

const SECTIONS: readonly AdvisorSection[] = ['recommendations', 'skills'];

const normalizeSection = (value: unknown): AdvisorSection =>
  typeof value === 'string' && (SECTIONS as readonly string[]).includes(value)
    ? (value as AdvisorSection)
    : 'recommendations';

interface SetupAdvisorNavState {
  section: AdvisorSection;
  /** `unknown` on purpose: `onClick={openSheet}` would otherwise land a click event as the section. */
  openSheet: (section?: unknown) => void;
  setSection: (section: AdvisorSection) => void;
}

export const useSetupAdvisor = create<SetupAdvisorNavState>((set) => ({
  section: 'recommendations',
  openSheet: (section) => {
    useUiPrefs.getState().setSidebarView('advisor');
    if (section !== undefined) set({ section: normalizeSection(section) });
  },
  setSection: (section) => set({ section: normalizeSection(section) }),
}));

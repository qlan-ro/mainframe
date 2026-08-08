/**
 * MainToolbar.advisor.test.tsx (spec AC 3; plan T33)
 *
 * The Setup Advisor button's onClick hands the DOM click event to the nav
 * store's open action. Once that action takes a section argument, a naive
 * `onClick={openSetupAdvisor}` would pass the React synthetic event through
 * as the section — this pins the click landing on `recommendations`, never
 * the event object, and that the button's testid stays put.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));
// Neither the tab strip (aui runtime) nor the branch chip (live git read) is
// this suite's subject; both have their own suites.
vi.mock('@/features/session-tabs/SessionTabs', () => ({
  SessionTabs: () => <div data-testid="mock-session-tabs" />,
}));
vi.mock('@/features/git/BranchChip', () => ({
  BranchChip: () => <div data-testid="mock-branch-chip" />,
}));

import { MainToolbar } from '../MainToolbar';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { TooltipProvider } from '@v2/components/ui/tooltip';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern; SidebarProvider mounts it live).
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

beforeEach(() => {
  // Seed a decoy section so a click that fails to normalize (either because
  // the click event leaks through as the section, or the store doesn't
  // reset it) leaves a value other than 'recommendations' behind.
  useSetupAdvisor.setState({ open: false, section: 'skills' });
});

describe('MainToolbar — Setup Advisor open action arity', () => {
  it('clicking automation-recommender-open lands the section on recommendations, not the click event', () => {
    render(
      <MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectId="p1" port={31415} />,
    );

    const button = screen.getByTestId('automation-recommender-open');
    fireEvent.click(button);

    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('recommendations');
    expect(typeof state.section).toBe('string');
  });

  it('keeps the automation-recommender-open testid on the toolbar button', () => {
    render(
      <MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectId="p1" port={31415} />,
    );

    expect(screen.getByTestId('automation-recommender-open').tagName).toBe('BUTTON');
  });
});

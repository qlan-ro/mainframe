/**
 * MainToolbar.advisor.test.tsx (spec AC 3; plan T33)
 *
 * The Setup Advisor button's onClick hands the DOM click event to the nav
 * store's open action. Once that action takes a section argument, a naive
 * `onClick={openSetupAdvisor}` would pass the React synthetic event through
 * as the section — this pins the click landing on `recommendations`, never
 * the event object, and that the button's testid stays put.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));
vi.mock('@/lib/api/git', () => ({ getGitBranch: vi.fn().mockResolvedValue({ branch: null }) }));
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: (props: { children?: React.ReactNode }) => <>{props.children}</>,
}));

import { MainToolbar } from '../MainToolbar';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';

beforeEach(() => {
  // Seed a decoy section so a click that fails to normalize (either because
  // the click event leaks through as the section, or the store doesn't
  // reset it) leaves a value other than 'recommendations' behind.
  useSetupAdvisor.setState({ open: false, section: 'skills' });
});

describe('MainToolbar — Setup Advisor open action arity', () => {
  it('clicking automation-recommender-open lands the section on recommendations, not the click event', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        projectId="p1"
        windowStyle="glass"
        port={31415}
      />,
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
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        projectId="p1"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.getByTestId('automation-recommender-open').tagName).toBe('BUTTON');
  });
});

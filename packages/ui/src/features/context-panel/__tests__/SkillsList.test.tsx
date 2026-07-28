import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const useSidebarSkills = vi.fn();
vi.mock('../use-sidebar-skills', () => ({ useSidebarSkills: () => useSidebarSkills() }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

import { SkillsList } from '../SkillsList';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';

const renderList = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  useSetupAdvisor.setState({ open: false, section: 'recommendations' });
});

describe('SkillsList', () => {
  it('shows the empty state when there are no skills', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList(<SkillsList />);
    expect(screen.getByText('No skills')).toBeInTheDocument();
  });

  it('renders a row per skill with the /name and scope', () => {
    useSidebarSkills.mockReturnValue({
      skills: [
        {
          id: 's1',
          name: 'clean-code',
          displayName: 'clean-code',
          description: 'd',
          scope: 'global',
          filePath: '/x.md',
        },
      ],
      agents: [],
      loading: false,
    });
    renderList(<SkillsList />);
    const row = screen.getByTestId('sidebar-skill-item-s1');
    expect(row).toHaveTextContent('/clean-code');
    expect(row).toHaveTextContent('global');
  });

  it('renders the manage-skills link in the empty state', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList(<SkillsList />);
    expect(screen.getByTestId('sidebar-skills-manage')).toBeInTheDocument();
  });

  it('renders the manage-skills link in the populated state', () => {
    useSidebarSkills.mockReturnValue({
      skills: [
        {
          id: 's1',
          name: 'clean-code',
          displayName: 'clean-code',
          description: 'd',
          scope: 'global',
          filePath: '/x.md',
        },
      ],
      agents: [],
      loading: false,
    });
    renderList(<SkillsList />);
    expect(screen.getByTestId('sidebar-skills-manage')).toBeInTheDocument();
  });

  it('opens the dialog on the skills section when the manage-skills link is clicked', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList(<SkillsList />);

    fireEvent.click(screen.getByTestId('sidebar-skills-manage'));

    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'skills' });
  });

  it('renders no delete affordance', () => {
    useSidebarSkills.mockReturnValue({
      skills: [
        {
          id: 's1',
          name: 'clean-code',
          displayName: 'clean-code',
          description: 'd',
          scope: 'global',
          filePath: '/x.md',
        },
      ],
      agents: [],
      loading: false,
    });
    renderList(<SkillsList />);

    expect(screen.queryAllByTestId(/^sidebar-skill-delete/)).toHaveLength(0);
  });
});

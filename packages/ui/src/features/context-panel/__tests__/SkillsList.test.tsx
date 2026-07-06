import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const useSidebarSkills = vi.fn();
vi.mock('../use-sidebar-skills', () => ({ useSidebarSkills: () => useSidebarSkills() }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

import { SkillsList } from '../SkillsList';

const renderList = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

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
});

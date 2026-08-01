/**
 * SkillsList.manage-link.test.tsx (spec AC 18; plan T41 / Group I4)
 *
 * Red until `SkillsList` gains the `sidebar-skills-manage` link (Group J3).
 * The sidebar tab stays strictly read-only — no install/uninstall/delete
 * affordance and no `skills-section-*` testid ever appears here — and gains
 * exactly one link that opens the Setup Advisor straight onto the Skills
 * section, present in every render state (rows, loading, empty).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

const useSidebarSkills = vi.fn();
vi.mock('../use-sidebar-skills', () => ({ useSidebarSkills: () => useSidebarSkills() }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

import { SkillsList } from '../SkillsList';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';

const renderList = () =>
  render(
    <TooltipProvider>
      <SkillsList />
    </TooltipProvider>,
  );

beforeEach(() => {
  useSetupAdvisor.setState({ open: false } as never);
});

describe('SkillsList — stays read-only', () => {
  it('renders no install/uninstall/delete affordance and no skills-section-* testid', () => {
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
    const { container } = renderList();

    expect(screen.queryByText(/uninstall|install|delete/i)).toBeNull();
    expect(container.querySelector('[data-testid^="skills-section-"]')).toBeNull();
  });
});

describe('SkillsList — manage link', () => {
  it('renders exactly one sidebar-skills-manage link', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList();

    expect(screen.getAllByTestId('sidebar-skills-manage')).toHaveLength(1);
  });

  it('clicking it opens the Setup Advisor on the skills section', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList();

    fireEvent.click(screen.getByTestId('sidebar-skills-manage'));

    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'skills' });
  });

  it('renders in the loading state', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: true });
    renderList();

    expect(screen.getByTestId('sidebar-skills-manage')).toBeInTheDocument();
  });

  it('renders in the empty state', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList();

    expect(screen.getByTestId('sidebar-skills-manage')).toBeInTheDocument();
  });
});

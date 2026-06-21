import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const useSidebarSkills = vi.fn();
vi.mock('../use-sidebar-skills', () => ({ useSidebarSkills: () => useSidebarSkills() }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

import { AgentsList } from '../AgentsList';

const renderList = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('AgentsList', () => {
  it('shows the empty state when there are no agents', () => {
    useSidebarSkills.mockReturnValue({ skills: [], agents: [], loading: false });
    renderList(<AgentsList />);
    expect(screen.getByText('No agents')).toBeInTheDocument();
  });

  it('renders a row per agent with the name and scope', () => {
    useSidebarSkills.mockReturnValue({
      skills: [],
      agents: [{ id: 'a1', name: 'pr-reviewer', description: 'd', scope: 'project', filePath: '/a.md' }],
      loading: false,
    });
    renderList(<AgentsList />);
    const row = screen.getByTestId('sidebar-agent-item-a1');
    expect(row).toHaveTextContent('pr-reviewer');
    expect(row).toHaveTextContent('project');
  });
});

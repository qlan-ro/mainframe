import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useSessionContext = vi.fn();
const useSidebarSkills = vi.fn();

vi.mock('../use-session-context', () => ({ useSessionContext: () => useSessionContext() }));
vi.mock('../use-sidebar-skills', () => ({ useSidebarSkills: () => useSidebarSkills() }));
vi.mock('../ContextInspector', () => ({ ContextInspector: () => <div data-testid="ctx-body" /> }));
vi.mock('../SkillsList', () => ({ SkillsList: () => <div data-testid="skills-body" /> }));
vi.mock('../AgentsList', () => ({ AgentsList: () => <div data-testid="agents-body" /> }));

import { BottomPanel } from '../BottomPanel';
import { useBottomPanel, BOTTOM_PANEL_DEFAULT_HEIGHT } from '@/store/bottom-panel';

beforeEach(() => {
  useBottomPanel.setState({ tab: 'context', height: BOTTOM_PANEL_DEFAULT_HEIGHT });
  useSessionContext.mockReturnValue({
    chatId: 'c1',
    context: {
      globalFiles: [{ path: 'g' }],
      projectFiles: [{ path: 'p' }],
      mentions: [],
      attachments: [],
      modifiedFiles: [],
      skillFiles: [],
    },
  });
  useSidebarSkills.mockReturnValue({
    skills: [{ id: 's1' }, { id: 's2' }],
    agents: [{ id: 'a1' }],
    loading: false,
  });
});

describe('BottomPanel', () => {
  it('renders three tabs with count badges and the context body by default', () => {
    render(<BottomPanel />);
    expect(screen.getByTestId('sidebar-bottom-tab-context')).toHaveTextContent('2'); // 1 global + 1 project
    expect(screen.getByTestId('sidebar-bottom-tab-skills')).toHaveTextContent('2');
    expect(screen.getByTestId('sidebar-bottom-tab-agents')).toHaveTextContent('1');
    expect(screen.getByTestId('ctx-body')).toBeInTheDocument();
  });

  it('switches the active body when a tab is clicked', () => {
    render(<BottomPanel />);
    fireEvent.click(screen.getByTestId('sidebar-bottom-tab-skills'));
    expect(screen.getByTestId('skills-body')).toBeInTheDocument();
    expect(useBottomPanel.getState().tab).toBe('skills');
  });
});

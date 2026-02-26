import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewTab } from '../../../renderer/components/sandbox/PreviewTab';
import { useUIStore } from '../../../renderer/store/ui';
import { useSandboxStore } from '../../../renderer/store/sandbox';
import { useProjectsStore } from '../../../renderer/store/projects';

vi.mock('../../../renderer/hooks/useLaunchConfig', () => ({
  useLaunchConfig: vi.fn(() => null),
}));

describe('PreviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stores to default state
    useUIStore.setState({
      panelSizes: { left: 240, right: 280, bottom: 200 },
      panelCollapsed: { left: false, right: false, bottom: true },
      panelVisible: false,
      leftPanelTab: 'chats',
      rightPanelTab: 'diff',
    });
    useSandboxStore.setState({
      processStatuses: {},
      logsOutput: [],
    });
    useProjectsStore.setState({
      activeProjectId: 'proj-1',
    });
  });

  it('minimize button calls setPanelVisible(false)', async () => {
    const user = userEvent.setup();
    render(<PreviewTab />);

    // Find the minimize button by its title attribute
    const minimizeButton = screen.getByTitle('Minimize');
    expect(minimizeButton).toBeInTheDocument();
    expect(minimizeButton).toHaveTextContent('_');

    // Click the minimize button
    await user.click(minimizeButton);

    // Verify that panelVisible was updated to false in the store
    const state = useUIStore.getState();
    expect(state.panelVisible).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewTab } from '../../../renderer/components/sandbox/PreviewTab';
import { useSandboxStore } from '../../../renderer/store/sandbox';
import { useChatsStore } from '../../../renderer/store/chats';
import { TooltipProvider } from '../../../renderer/components/ui/tooltip.js';

vi.mock('../../../renderer/hooks/useLaunchConfig', () => ({
  useLaunchConfig: vi.fn(() => null),
}));

vi.mock('../../../renderer/hooks/useActiveProjectId.js', () => ({
  useActiveProjectId: vi.fn(() => 'proj-1'),
  getActiveProjectId: vi.fn(() => 'proj-1'),
}));

describe('PreviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSandboxStore.setState({
      processStatuses: {},
      logsOutput: [],
    });
    useChatsStore.setState({
      activeChatId: 'chat-1',
      chats: [{ id: 'chat-1', projectId: 'proj-1' }] as never,
    });
  });

  it('renders the preview tab', () => {
    render(
      <TooltipProvider>
        <PreviewTab />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('preview-tab')).toBeInTheDocument();
  });
});

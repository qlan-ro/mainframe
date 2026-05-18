import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewTab, scaleCropRect } from '../../../renderer/components/sandbox/PreviewTab';
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

describe('scaleCropRect', () => {
  it('returns identical values at zoom 1.0', () => {
    const rect = { x: 100, y: 200, width: 300, height: 150 };
    expect(scaleCropRect(rect, 1.0)).toEqual({ x: 100, y: 200, width: 300, height: 150 });
  });

  it('scales up correctly at zoom 1.25', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(scaleCropRect(rect, 1.25)).toEqual({ x: 13, y: 25, width: 125, height: 63 });
  });

  it('scales down correctly at zoom 0.8', () => {
    const rect = { x: 100, y: 200, width: 400, height: 200 };
    expect(scaleCropRect(rect, 0.8)).toEqual({ x: 80, y: 160, width: 320, height: 160 });
  });

  it('rounds fractional device pixels', () => {
    const rect = { x: 1, y: 1, width: 3, height: 3 };
    // 1 * 1.5 = 1.5 → 2, 3 * 1.5 = 4.5 → 5
    expect(scaleCropRect(rect, 1.5)).toEqual({ x: 2, y: 2, width: 5, height: 5 });
  });
});

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

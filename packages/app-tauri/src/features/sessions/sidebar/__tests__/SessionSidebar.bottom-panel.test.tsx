import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the bottom-panel children so this test stays focused on composition.
vi.mock('@/features/context-panel/BottomPanel', () => ({
  BottomPanel: () => <div data-testid="bottom-panel-stub" />,
}));
vi.mock('@/features/context-panel/PanelResizeHandle', () => ({
  PanelResizeHandle: () => <div data-testid="sidebar-bottom-resize" />,
}));

// Mock the data/runtime surface of SessionSidebar so it renders without a real runtime.
vi.mock('@assistant-ui/react', () => ({
  ThreadListPrimitive: { New: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  useAssistantRuntime: () => ({ threads: { getState: () => ({}) } }),
}));
vi.mock('../../view-model/chat-to-thread-custom', () => ({ threadListStateToSessionItems: () => [] }));
vi.mock('../../view-model/group-sessions', () => ({ arrangeSessions: () => [] }));
vi.mock('../../view-model/attention-counts', () => ({ attentionCount: () => 0 }));
vi.mock('../../view-model/project-activity', () => ({ sortProjectsByRecentActivity: () => [] }));
vi.mock('../../filter/apply-session-filters', () => ({ applySessionFilters: () => [] }));
vi.mock('../../view-model/count-by-base-status', () => ({
  countByBaseStatus: () => ({ working: 0, waiting: 0, idle: 0 }),
}));
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: () => ({
    filterProjectId: null,
    selectedTags: new Set(),
    selectedSynthetic: new Set(),
    sortMode: 'recent',
    setFilterProjectId: vi.fn(),
    setSortMode: vi.fn(),
  }),
}));
vi.mock('@/store/unread-store', () => ({
  useUnreadStore: (sel: (s: unknown) => unknown) => sel({ isUnread: () => false, unread: new Set() }),
}));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: [], removeProjectFromList: vi.fn() }) }));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('../../tags/use-tag-registry', () => ({ useTagRegistry: () => ({ colorOf: () => '#000' }) }));
vi.mock('../SessionSortMenu', () => ({ SessionSortMenu: () => null }));
vi.mock('../SessionsMoreMenu', () => ({ SessionsMoreMenu: () => null }));
vi.mock('../ProjectFilterPillBar', () => ({ ProjectFilterPillBar: () => null }));
vi.mock('../../filter/TagFilterBar', () => ({ TagFilterBar: () => null }));
vi.mock('@/layout/SidebarFooter', () => ({ SidebarFooter: () => <div data-testid="sidebar-footer" /> }));
vi.mock('@/lib/api/projects', () => ({ removeProject: vi.fn() }));

import { SessionSidebar } from '../SessionSidebar';

describe('SessionSidebar bottom-panel composition', () => {
  it('mounts the resize handle and bottom panel above the footer', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sidebar-bottom-resize')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-panel-stub')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
  });
});

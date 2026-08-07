/**
 * InspectorPane — the right-side Inspector: the active session's project file
 * tree, and nothing else.
 *
 * Behaviors covered:
 *  - No active project → the "Open a session to browse its files." empty
 *    state renders; `<FileTree />` does not.
 *  - Active project → `<FileTree />` renders, receiving port/projectId/chatId
 *    straight from useActiveIdentity.
 *  - The deleted Files/Changes tab bar, changes badge, and BottomPanel are
 *    gone for good: their testids are absent in both states.
 *  - `inspector-pane` root testid is present in both states.
 *
 * Mocked dependencies:
 *  - @/features/sessions/use-active-identity — controls projectId/chatId.
 *  - ./FileTree — replaced with a stub that records its props via a testid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseActiveIdentity = vi.fn();
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => mockUseActiveIdentity(),
}));

vi.mock('../FileTree', () => ({
  FileTree: (props: { port: number; projectId: string; chatId?: string }) => (
    <div
      data-testid="file-tree-stub"
      data-port={props.port}
      data-project-id={props.projectId}
      data-chat-id={props.chatId ?? ''}
    />
  ),
}));

import { InspectorPane } from '../InspectorPane';

beforeEach(() => {
  mockUseActiveIdentity.mockReset();
});

describe('InspectorPane — no active project', () => {
  beforeEach(() => {
    mockUseActiveIdentity.mockReturnValue({ projectId: null, chatId: null, projectName: null });
  });

  it('renders the inspector-pane root', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.getByTestId('inspector-pane')).toBeTruthy();
  });

  it('renders the empty-state message', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.getByText('Open a session to browse its files.')).toBeTruthy();
  });

  it('does not render the file tree', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.queryByTestId('file-tree-stub')).toBeNull();
  });

  it('does not render the deleted tab bar or changes badge', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.queryByTestId('inspector-tab-files')).toBeNull();
    expect(screen.queryByTestId('inspector-tab-changes')).toBeNull();
  });

  it('does not render a BottomPanel or panel-resize-handle', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.queryByTestId('bottom-panel')).toBeNull();
    expect(screen.queryByTestId('panel-resize-handle')).toBeNull();
  });
});

describe('InspectorPane — active project', () => {
  beforeEach(() => {
    mockUseActiveIdentity.mockReturnValue({ projectId: 'proj-1', chatId: 'chat-1', projectName: 'Test Project' });
  });

  it('renders the inspector-pane root', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.getByTestId('inspector-pane')).toBeTruthy();
  });

  it('renders the file tree instead of the empty state', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.getByTestId('file-tree-stub')).toBeTruthy();
    expect(screen.queryByText('Open a session to browse its files.')).toBeNull();
  });

  it('passes port, projectId, and chatId from useActiveIdentity to FileTree', () => {
    render(<InspectorPane port={31415} />);
    const tree = screen.getByTestId('file-tree-stub');
    expect(tree.getAttribute('data-port')).toBe('31415');
    expect(tree.getAttribute('data-project-id')).toBe('proj-1');
    expect(tree.getAttribute('data-chat-id')).toBe('chat-1');
  });

  it('does not render the deleted tab bar or changes badge', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.queryByTestId('inspector-tab-files')).toBeNull();
    expect(screen.queryByTestId('inspector-tab-changes')).toBeNull();
  });

  it('does not render a BottomPanel or panel-resize-handle', () => {
    render(<InspectorPane port={31415} />);
    expect(screen.queryByTestId('bottom-panel')).toBeNull();
    expect(screen.queryByTestId('panel-resize-handle')).toBeNull();
  });
});

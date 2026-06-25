import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const useSessionContext = vi.fn();
vi.mock('../use-session-context', () => ({ useSessionContext: () => useSessionContext() }));
vi.mock('../SessionAttachmentsGrid', () => ({ SessionAttachmentsGrid: () => <div data-testid="attach-grid" /> }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

import { ContextInspector } from '../ContextInspector';

const renderInspector = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

function ctx(p: Partial<SessionContext>): SessionContext {
  return { globalFiles: [], projectFiles: [], mentions: [], attachments: [], modifiedFiles: [], skillFiles: [], ...p };
}

describe('ContextInspector', () => {
  it('shows the no-active-chat empty state', () => {
    useSessionContext.mockReturnValue({ context: null, chatId: undefined });
    renderInspector(<ContextInspector />);
    expect(screen.getByText('No active chat')).toBeInTheDocument();
  });

  it('shows the loading state when a chat is active but context is null', () => {
    useSessionContext.mockReturnValue({ context: null, chatId: 'chat-1' });
    renderInspector(<ContextInspector />);
    expect(screen.getByText('Loading context…')).toBeInTheDocument();
  });

  it('renders global/project/session sections with file rows', () => {
    useSessionContext.mockReturnValue({
      chatId: 'chat-1',
      context: ctx({
        globalFiles: [{ path: '~/CLAUDE.md', content: '', source: 'global' }],
        projectFiles: [{ path: 'CLAUDE.md', content: '', source: 'project' }],
        mentions: [{ id: '1', kind: 'file', source: 'user', name: 'a', path: 'src/a.ts', timestamp: 't' }],
      }),
    });
    renderInspector(<ContextInspector />);
    expect(screen.getByTestId('sidebar-context-item-~/CLAUDE.md')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-context-item-CLAUDE.md')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-context-section-session')).toHaveTextContent('1');
  });

  it('renders the Tasks section first when the chat has todos', () => {
    useSessionContext.mockReturnValue({
      chatId: 'c1',
      context: ctx({
        todos: [
          { content: 'A', status: 'completed', activeForm: 'Aing' },
          { content: 'B', status: 'pending', activeForm: 'Bing' },
        ],
      }),
    });
    renderInspector(<ContextInspector />);
    const tasks = screen.getByTestId('context-tasks-section');
    const global = screen.getByTestId('sidebar-context-section-global');
    expect(tasks).toBeInTheDocument();
    // Tasks appears before Global in DOM order.
    expect(tasks.compareDocumentPosition(global) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the Tasks section when there are no todos', () => {
    useSessionContext.mockReturnValue({
      chatId: 'c1',
      context: ctx({ todos: [] }),
    });
    renderInspector(<ContextInspector />);
    expect(screen.queryByTestId('context-tasks-section')).not.toBeInTheDocument();
  });
});

/**
 * ChatSurface — behavior tests (TDD red phase, post-interstitial-removal).
 *
 * The in-surface "choose a project" picker (NewThreadConfigPicker) is gone;
 * ChatSurface now branches into ChatEmptyState variants instead:
 *
 *  1. Zero projects (first-run) → the firstrun hero only — NO ChatThread at all
 *     (there is nowhere to send a message yet).
 *  2. A brand-new local thread (__LOCALID_* / status 'new' / no messages) whose
 *     draft already resolved a project → ChatThread renders WITH the welcome
 *     empty-state passed through as its `emptyState` prop (composer stays live).
 *  3. Anything else (a pre-existing/regular chat with messages) → a plain
 *     ChatThread, no welcome empty-state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let __mainThreadId: string | null = '__LOCALID_1';
let __itemStatus: string | undefined = 'new';
let __messageCount = 0;
let __projects: { id: string }[] = [{ id: 'proj-a' }];
let __loading = false;

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({
      threads: { mainThreadId: __mainThreadId },
      threadListItem: { id: __mainThreadId, status: __itemStatus },
      thread: { messages: { length: __messageCount } },
    }),
}));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: __projects, loading: __loading }) }));
vi.mock('../../runtime/draft-config', () => ({
  useDraftConfigStore: (sel: (s: unknown) => unknown) =>
    sel({ drafts: new Map([['__LOCALID_1', { projectId: 'proj-a', adapterId: 'claude' }]]) }),
}));
vi.mock('../use-new-thread-auto-config', () => ({ useNewThreadAutoConfig: () => undefined }));
vi.mock('../../../chat/thread/ChatThread', () => ({
  ChatThread: ({ emptyState }: { emptyState?: React.ReactNode }) => <div data-testid="chat-thread">{emptyState}</div>,
}));
vi.mock('../../../chat/thread/ChatCardHeader', () => ({ ChatCardHeader: () => <div data-testid="chat-header" /> }));
vi.mock('../ChatEmptyState', () => ({
  ChatEmptyState: ({ variant }: { variant: string }) => <div data-testid={`empty-${variant}`} />,
}));

import { ChatSurface } from '../ChatSurface';

describe('ChatSurface', () => {
  beforeEach(() => {
    __mainThreadId = '__LOCALID_1';
    __itemStatus = 'new';
    __messageCount = 0;
    __projects = [{ id: 'proj-a' }];
    __loading = false;
  });

  it('renders the first-run hero (no ChatThread) when there are no projects', () => {
    __projects = [];
    __loading = false;
    render(<ChatSurface port={31415} />);
    expect(screen.getByTestId('empty-firstrun')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).toBeNull();
  });

  it('does not show the first-run hero while projects are still loading', () => {
    __projects = [];
    __loading = true;
    render(<ChatSurface port={31415} />);
    expect(screen.queryByTestId('empty-firstrun')).toBeNull();
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
  });

  it('renders ChatThread with the welcome empty-state for a resolved draft', () => {
    render(<ChatSurface port={31415} />);
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.getByTestId('empty-welcome')).toBeInTheDocument();
  });

  it('renders a plain ChatThread (no empty-state) for a non-draft chat', () => {
    __mainThreadId = 'chat-123';
    __itemStatus = 'regular';
    __messageCount = 4;
    render(<ChatSurface port={31415} />);
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-welcome')).toBeNull();
  });
});

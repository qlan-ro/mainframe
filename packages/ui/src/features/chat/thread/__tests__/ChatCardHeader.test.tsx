import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

let fakeState: any = { threadListItem: { title: 'Fixture Chat', custom: { detectedPrs: [] } } };
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: any) => unknown) => sel({ threads: { threadItems: [] }, ...fakeState }),
}));

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

// Draft-mode collaborators — not exercised by the non-draft structural suite
// below, but ChatCardHeader reads them unconditionally to detect a draft
// thread. Safe empty-ish defaults keep the existing (non-draft) tests inert.
let fakeDrafts = new Map<string, { projectId: string; adapterId: string }>();
vi.mock('../../../sessions/runtime/draft-config', () => ({
  useDraftConfigStore: (sel: (s: { drafts: Map<string, { projectId: string; adapterId: string }> }) => unknown) =>
    sel({ drafts: fakeDrafts }),
}));
let fakeProjects: { id: string; name: string }[] = [];
vi.mock('../../../sessions/use-projects', () => ({
  useProjects: () => ({ projects: fakeProjects }),
}));

// ChatSessionInline pulls chat-thread + adapter-registry data that this suite
// doesn't otherwise fixture; stub it to fixed testid markers so ChatCardHeader
// structure/order assertions don't depend on that data layer.
vi.mock('../ChatSessionInline', () => ({
  ChatSessionInline: ({ part }: { part: 'model' | 'status' }) =>
    part === 'model' ? (
      <span data-testid="chat-header-model">Sonnet 4.6</span>
    ) : (
      <span data-testid="chat-header-context">
        <span data-testid="chat-header-context-pct">42%</span>
      </span>
    ),
}));

import { ChatCardHeader } from '../ChatCardHeader';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';

let fakeHost: FakeHostBridge;

function renderHeader() {
  return render(
    <HostProvider host={fakeHost}>
      <ChatCardHeader />
    </HostProvider>,
  );
}

// Reset the layout store to a fresh chat-only state before each test so
// mutation from one test does not bleed into the next.
beforeEach(() => {
  fakeHost = new FakeHostBridge();
  vi.spyOn(fakeHost.shell, 'openExternal').mockResolvedValue(undefined);
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
  });
  fakeState = { threadListItem: { title: 'Fixture Chat', custom: { detectedPrs: [] } } };
  fakeDrafts = new Map();
  fakeProjects = [];
  mockEmit.mockReset();
});

describe('ChatCardHeader — structure', () => {
  it('renders the chat-header root with the session title', () => {
    renderHeader();

    const root = screen.getByTestId('chat-header');
    expect(root).toBeDefined();
    expect(screen.getByText('Fixture Chat')).toBeDefined();
  });

  it('carries the drag-region attribute on the root element', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header').hasAttribute('data-drag-region')).toBe(true);
  });

  it('has the fixed h-[36px] height class (uniform SurfaceTabStrip height, 15.5)', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveClass('h-[36px]');
  });

  it('renders grip and message-square icons as SVGs inside the header', () => {
    renderHeader();

    const root = screen.getByTestId('chat-header');
    const svgs = root.querySelectorAll('svg');
    // GripHorizontal + MessageSquare — at least two SVG icons present
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the ChatSessionInline model slot', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header-model')).toBeInTheDocument();
  });

  it('renders the ChatSessionInline status (context meter) slot', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header-context')).toBeInTheDocument();
    expect(screen.getByTestId('chat-header-context-pct')).toBeInTheDocument();
  });
});

describe('ChatCardHeader — split buttons', () => {
  it('renders both split buttons when layoutCanSplit is true', () => {
    // The initial layout (chat-only) satisfies layoutCanSplit.
    expect(layoutCanSplit(useLayoutStore.getState().layout)).toBe(true);

    renderHeader();

    expect(screen.getByTestId('chat-header-split-right')).toBeDefined();
    expect(screen.getByTestId('chat-header-split-down')).toBeDefined();
  });

  it('clicking split-right adds a non-chat surface to the top row', () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('chat-header-split-right'));

    const { layout } = useLayoutStore.getState();
    // splitSurface('v') places the next missing surface (files) into the top row.
    expect(layout.top).toContain('files');
  });

  it('clicking split-down places a non-chat surface in the bottom strip', () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('chat-header-split-down'));

    const { layout } = useLayoutStore.getState();
    // splitSurface('h') sets the bottom strip to the next missing surface (files).
    expect(layout.bottom).toBe('files');
  });
});

describe('ChatCardHeader — fallback title', () => {
  it('shows "Untitled" when threadListItem title is null', () => {
    fakeState = { threadListItem: { title: null, custom: { detectedPrs: [] } } };

    renderHeader();

    expect(screen.getByText('Untitled')).toBeDefined();
  });
});

describe('ChatCardHeader — PRs + review', () => {
  it('renders a PR link per detectedPr', () => {
    fakeState.threadListItem.custom.detectedPrs = [
      { url: 'https://github.com/o/r/pull/249', owner: 'o', repo: 'r', number: 249, source: 'created' },
      { url: 'https://github.com/o/r/pull/250', owner: 'o', repo: 'r', number: 250, source: 'mentioned' },
    ];

    renderHeader();

    const pr249 = screen.getByTestId('chat-header-pr-249');
    const pr250 = screen.getByTestId('chat-header-pr-250');
    expect(pr249).toBeDefined();
    expect(pr250).toBeDefined();
    expect(pr249.textContent).toContain('#249');
    expect(pr250.textContent).toContain('#250');
  });

  it('clicking a PR link opens it externally', () => {
    fakeState.threadListItem.custom.detectedPrs = [
      { url: 'https://github.com/o/r/pull/249', owner: 'o', repo: 'r', number: 249, source: 'created' },
    ];

    renderHeader();
    fireEvent.click(screen.getByTestId('chat-header-pr-249'));

    expect(fakeHost.shell.openExternal).toHaveBeenCalledOnce();
    expect(fakeHost.shell.openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/249');
  });

  it('no PR links when detectedPrs is empty', () => {
    // fakeState already has detectedPrs: [] from beforeEach reset
    renderHeader();

    expect(screen.queryByTestId('chat-header-pr-249')).toBeNull();
    expect(document.querySelector('[data-testid^="chat-header-pr-"]')).toBeNull();
  });

  it('renders a disabled Review button when worktreePath is absent', () => {
    // fakeState has no worktreePath in custom
    renderHeader();

    expect(screen.getByTestId('chat-header-review')).toBeDisabled();
  });

  it('places the Review button before the first PR link in DOM order', () => {
    fakeState.threadListItem.custom.detectedPrs = [
      { url: 'https://github.com/o/r/pull/249', owner: 'o', repo: 'r', number: 249, source: 'created' },
      { url: 'https://github.com/o/r/pull/250', owner: 'o', repo: 'r', number: 250, source: 'mentioned' },
    ];

    renderHeader();

    const root = screen.getByTestId('chat-header');
    const review = screen.getByTestId('chat-header-review');
    const pr249 = screen.getByTestId('chat-header-pr-249');
    const position = review.compareDocumentPosition(pr249);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.contains(review)).toBe(true);
    expect(root.contains(pr249)).toBe(true);
  });
});

describe('ChatCardHeader — review button gating', () => {
  it('review button is disabled when worktreePath is undefined', () => {
    fakeState = { threadListItem: { title: 'Chat', custom: { detectedPrs: [], worktreePath: undefined } } };
    renderHeader();
    expect(screen.getByTestId('chat-header-review')).toBeDisabled();
  });

  it('review button is enabled when worktreePath is set', () => {
    fakeState = {
      threadListItem: { title: 'Chat', custom: { detectedPrs: [], worktreePath: '/Users/me/proj' } },
    };
    renderHeader();
    expect(screen.getByTestId('chat-header-review')).not.toBeDisabled();
  });

  it('clicking the enabled review button emits open-review', () => {
    fakeState = {
      threadListItem: { title: 'Chat', custom: { detectedPrs: [], worktreePath: '/Users/me/proj' } },
    };
    renderHeader();
    fireEvent.click(screen.getByTestId('chat-header-review'));
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-review' });
  });
});

describe('ChatCardHeader — Hide Chat (dynamic floor)', () => {
  it('disables the Hide-Chat button when chat is the only lit surface (the floor)', () => {
    renderHeader();
    expect(screen.getByTestId('chat-header-hide')).toBeDisabled();
  });

  it('enables Hide-Chat once another surface is lit, and hiding removes chat', () => {
    useLayoutStore.getState().toggleSurface('files'); // chat + files lit
    renderHeader();
    const hide = screen.getByTestId('chat-header-hide');
    expect(hide).not.toBeDisabled();
    fireEvent.click(hide);
    const { layout } = useLayoutStore.getState();
    expect(layout.top.includes('chat') || layout.bottom === 'chat').toBe(false);
    expect(layout.top.includes('files')).toBe(true);
  });
});

describe('ChatCardHeader — draft variant', () => {
  it('shows "New Session" + project chip and hides model/review for a draft', () => {
    fakeState = { threadListItem: { id: '__LOCALID_1', status: 'new' } };
    fakeDrafts = new Map([['__LOCALID_1', { projectId: 'proj-a', adapterId: 'claude' }]]);
    fakeProjects = [{ id: 'proj-a', name: 'Mainframe' }];

    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveTextContent('New Session');
    expect(screen.getByTestId('chat-header-project')).toHaveTextContent('Mainframe');
    expect(screen.queryByTestId('chat-header-model')).toBeNull();
    expect(screen.queryByTestId('chat-header-review')).toBeNull();
  });

  it('renders the normal header (model chip, review) for a real chat', () => {
    fakeState = { threadListItem: { id: 'chat-123', status: 'regular', title: 'Fix bug', custom: {} } };

    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveTextContent('Fix bug');
    expect(screen.getByTestId('chat-header-model')).toBeInTheDocument();
    expect(screen.getByTestId('chat-header-review')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@v2/components/ui/tooltip';
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

// ChatModelChip pulls chat-thread + adapter-registry data that this suite
// doesn't otherwise fixture; stub it to a fixed testid marker so ChatCardHeader
// structure/order assertions don't depend on that data layer.
vi.mock('../ChatModelChip', () => ({
  ChatModelChip: () => <span data-testid="chat-header-model">Sonnet 4.6</span>,
}));

import { ChatCardHeader } from '../ChatCardHeader';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';

let fakeHost: FakeHostBridge;

function renderHeader() {
  // The header is full of v2 `Hint`s, which carry no provider of their own
  // (shadcn treats that as an app-root concern; the v1 provider satisfies
  // nothing). Compose it INTO the host wrapper rather than beside it.
  return render(
    <TooltipProvider>
      <HostProvider host={fakeHost}>
        <ChatCardHeader />
      </HostProvider>
    </TooltipProvider>,
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

  it('has the 36px surface-header height (h-9, shared with the workspace strip)', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveClass('h-9');
  });

  it('renders grip and message-square icons as SVGs inside the header', () => {
    renderHeader();

    const root = screen.getByTestId('chat-header');
    const svgs = root.querySelectorAll('svg');
    // GripHorizontal + MessageSquare — at least two SVG icons present
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the ChatModelChip slot', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header-model')).toBeInTheDocument();
  });

  it('no longer renders a context meter — the session panel owns that number', () => {
    renderHeader();

    expect(screen.queryByTestId('chat-header-context')).toBeNull();
    expect(screen.queryByTestId('chat-header-context-pct')).toBeNull();
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
    // splitSurface('v') places the workspace surface into the top row.
    expect(layout.top).toContain('workspace');
  });

  it('clicking split-down places a non-chat surface in the bottom strip', () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('chat-header-split-down'));

    const { layout } = useLayoutStore.getState();
    // splitSurface('h') puts the workspace surface in the bottom strip.
    expect(layout.bottom).toBe('workspace');
  });
});

describe('ChatCardHeader — fallback title', () => {
  it('shows "Untitled" when threadListItem title is null', () => {
    fakeState = { threadListItem: { title: null, custom: { detectedPrs: [] } } };

    renderHeader();

    expect(screen.getByText('Untitled')).toBeDefined();
  });
});

describe('ChatCardHeader — PR pills are GONE', () => {
  it('renders no PR link even when detectedPrs is populated — the session panel Summary owns PRs', () => {
    fakeState.threadListItem.custom.detectedPrs = [
      { url: 'https://github.com/o/r/pull/249', owner: 'o', repo: 'r', number: 249, source: 'created' },
    ];

    renderHeader();

    expect(document.querySelector('[data-testid^="chat-header-pr-"]')).toBeNull();
  });
});

describe('ChatCardHeader — Hide Chat (dynamic floor)', () => {
  it('disables the Hide-Chat button when chat is the only lit surface (the floor)', () => {
    renderHeader();
    expect(screen.getByTestId('chat-header-hide')).toBeDisabled();
  });

  it('enables Hide-Chat once another surface is lit, and hiding removes chat', () => {
    useLayoutStore.getState().toggleSurface('workspace'); // chat + workspace lit
    renderHeader();
    const hide = screen.getByTestId('chat-header-hide');
    expect(hide).not.toBeDisabled();
    fireEvent.click(hide);
    const { layout } = useLayoutStore.getState();
    expect(layout.top.includes('chat') || layout.bottom === 'chat').toBe(false);
    expect(layout.top.includes('workspace')).toBe(true);
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
  });

  it('renders the normal header (model chip) for a real chat', () => {
    fakeState = { threadListItem: { id: 'chat-123', status: 'regular', title: 'Fix bug', custom: {} } };

    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveTextContent('Fix bug');
    expect(screen.getByTestId('chat-header-model')).toBeInTheDocument();
  });
});

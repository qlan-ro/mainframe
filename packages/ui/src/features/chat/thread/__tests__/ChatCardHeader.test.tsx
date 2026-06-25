import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

let fakeState: any = { threadListItem: { title: 'Fixture Chat', custom: { detectedPrs: [] } } };
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: any) => unknown) => sel(fakeState),
}));

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

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

  it('has the fixed h-[38px] height class', () => {
    renderHeader();

    expect(screen.getByTestId('chat-header')).toHaveClass('h-[38px]');
  });

  it('renders grip and message-square icons as SVGs inside the header', () => {
    renderHeader();

    const root = screen.getByTestId('chat-header');
    const svgs = root.querySelectorAll('svg');
    // GripHorizontal + MessageSquare — at least two SVG icons present
    expect(svgs.length).toBeGreaterThanOrEqual(2);
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

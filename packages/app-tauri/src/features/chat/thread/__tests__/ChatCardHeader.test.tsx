import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn(() => 'Fixture Chat'),
}));

import { ChatCardHeader } from '../ChatCardHeader';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';

// Reset the layout store to a fresh chat-only state before each test so
// mutation from one test does not bleed into the next.
beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
  });
});

describe('ChatCardHeader — structure', () => {
  it('renders the chat-header root with the session title', () => {
    render(<ChatCardHeader />);

    const root = screen.getByTestId('chat-header');
    expect(root).toBeDefined();
    expect(screen.getByText('Fixture Chat')).toBeDefined();
  });

  it('carries the Tauri drag-region attribute on the root element', () => {
    render(<ChatCardHeader />);

    expect(screen.getByTestId('chat-header').hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('has the fixed h-[38px] height class', () => {
    render(<ChatCardHeader />);

    expect(screen.getByTestId('chat-header')).toHaveClass('h-[38px]');
  });

  it('renders grip and message-square icons as SVGs inside the header', () => {
    render(<ChatCardHeader />);

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

    render(<ChatCardHeader />);

    expect(screen.getByTestId('chat-header-split-right')).toBeDefined();
    expect(screen.getByTestId('chat-header-split-down')).toBeDefined();
  });

  it('clicking split-right adds a non-chat surface to the top row', () => {
    render(<ChatCardHeader />);

    fireEvent.click(screen.getByTestId('chat-header-split-right'));

    const { layout } = useLayoutStore.getState();
    // splitSurface('v') places the next missing surface (files) into the top row.
    expect(layout.top).toContain('files');
  });

  it('clicking split-down places a non-chat surface in the bottom strip', () => {
    render(<ChatCardHeader />);

    fireEvent.click(screen.getByTestId('chat-header-split-down'));

    const { layout } = useLayoutStore.getState();
    // splitSurface('h') sets the bottom strip to the next missing surface (files).
    expect(layout.bottom).toBe('files');
  });
});

describe('ChatCardHeader — fallback title', () => {
  it('shows "Untitled" when useAuiState returns null for the title', async () => {
    const { useAuiState } = await import('@assistant-ui/react');
    vi.mocked(useAuiState).mockReturnValueOnce(null);

    render(<ChatCardHeader />);

    expect(screen.getByText('Untitled')).toBeDefined();
  });
});

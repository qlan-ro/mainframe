/**
 * SurfaceHost — the outer wrapper carries only its flex-container classes,
 * the workspace reports its left edge for the title bar, and flex weights follow the
 * lone-pane and two-pane rules.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';

vi.mock('@/features/sessions/new-thread/ChatSurface', () => ({
  ChatSurface: () => <div data-testid="chat-surface-stub" />,
}));
vi.mock('../surfaces/WorkspaceSurface', () => ({
  WorkspaceSurface: () => <div data-testid="workspace-surface-stub" />,
}));
vi.mock('../SurfaceDragLayer', () => ({
  SurfaceDragLayer: () => null,
}));
vi.mock('@/store/intent-subscriber', () => ({
  subscribeToFileIntents: () => () => {},
}));
vi.mock('@/store/terminal-intent-subscriber', () => ({
  subscribeToTerminalIntents: () => () => {},
}));
vi.mock('@/store/url-tab-intent-subscriber', () => ({
  subscribeToUrlTabIntents: () => () => {},
}));

import { useColumnEdges } from '../column-edges';
import { SurfaceHost } from '../SurfaceHost';

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
  });
});

describe('SurfaceHost — flat shell geometry', () => {
  it('renders the outer wrapper with only the flex-container utilities', () => {
    render(<SurfaceHost />);

    const outer = screen.getByTestId('chat-thread-area');
    expect(outer.className).toBe('flex flex-1 flex-col overflow-hidden');
  });

  it('divides chat and workspace with a hairline', () => {
    useLayoutStore.setState({
      layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
    });
    const { container } = render(<SurfaceHost />);

    const divider = container.querySelector('[data-testid="surf-divider-x"]') as HTMLElement | null;
    expect(divider?.style.width).toBe('1px');
  });
});

describe('SurfaceHost — workspace edge', () => {
  const place = (top: ('chat' | 'workspace')[], bottom: 'workspace' | null = null) =>
    useLayoutStore.setState({ layout: { top, bottom, topFlex: {}, vFlex: { top: 1, bottom: 1 } } });

  it('reports the edge while the workspace sits beside the chat', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    expect(useColumnEdges.getState().workspace).toBe(0);
  });

  it.each([
    ['alone', ['workspace'] as const, null],
    ['in the bottom strip', ['chat'] as const, 'workspace' as const],
  ])('reports none while it is %s', (_, top, bottom) => {
    place([...top], bottom);
    render(<SurfaceHost />);
    expect(useColumnEdges.getState().workspace).toBeNull();
  });

  it('drops the edge when the workspace closes', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    act(() => place(['chat']));
    expect(useColumnEdges.getState().workspace).toBeNull();
  });
});

describe('SurfaceHost — lone pane reclaims the full row', () => {
  it('ignores a stale drag fraction when only one surface remains', () => {
    // A divider drag writes complementary fractions (< 1 each). After the
    // right surface closes, the survivor must NOT keep its fraction: a lone
    // flex child with grow < 1 fills only that FRACTION of the row (flexbox
    // distributes sum-of-grow free space when the sum is below 1).
    useLayoutStore.setState({
      layout: { top: ['chat'], bottom: null, topFlex: { chat: 0.3, workspace: 0.7 }, vFlex: { top: 1, bottom: 1 } },
    });
    const { container } = render(<SurfaceHost />);

    const pane = container.querySelector('[data-surface="chat"]') as HTMLElement;
    expect(pane.style.flex).toBe('1 1 0%');
  });

  it('keeps the dragged fractions while two surfaces share the row', () => {
    useLayoutStore.setState({
      layout: {
        top: ['chat', 'workspace'],
        bottom: null,
        topFlex: { chat: 0.3, workspace: 0.7 },
        vFlex: { top: 1, bottom: 1 },
      },
    });
    const { container } = render(<SurfaceHost />);

    const chat = container.querySelector('[data-surface="chat"]') as HTMLElement;
    const ws = container.querySelector('[data-surface="workspace"]') as HTMLElement;
    expect(chat.style.flex).toBe('0.3 1 0%');
    expect(ws.style.flex).toBe('0.7 1 0%');
  });
});

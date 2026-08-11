/**
 * SurfaceHost — the outer wrapper carries only its flex-container classes,
 * the divider gutter is the shared 9px value, and flex weights follow the
 * lone-pane and two-pane rules.
 */
import { render, screen } from '@testing-library/react';
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

  it('wires the shared gutter width through to the divider', () => {
    useLayoutStore.setState({
      layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
    });
    const { container } = render(<SurfaceHost />);

    const divider = container.querySelector('[data-testid="surf-divider-x"]') as HTMLElement | null;
    expect(divider?.style.width).toBe('9px');
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

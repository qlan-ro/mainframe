/**
 * SurfaceHost — SHELL_GEOMETRY wiring: the flat shell has no workspace inset,
 * and the divider gutter comes from the shared constant, not a hardcoded value.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';

vi.mock('@/features/sessions/new-thread/ChatSurface', () => ({
  ChatSurface: () => <div data-testid="chat-surface-stub" />,
}));
vi.mock('../surfaces/FilesSurface', () => ({
  FilesSurface: () => <div data-testid="files-surface-stub" />,
}));
vi.mock('../surfaces/RunSurface', () => ({
  RunSurface: () => <div data-testid="run-surface-stub" />,
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

import { SurfaceHost } from '../SurfaceHost';

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
  });
});

describe('SurfaceHost — flat shell geometry', () => {
  it('applies no inset classes to the outer wrapper', () => {
    render(<SurfaceHost port={31415} />);

    const outer = screen.getByTestId('chat-thread-area');
    expect(outer.className).not.toContain('pt-[4px]');
    expect(outer.className).not.toContain('px-[10px]');
  });

  it('wires the shared gutter width through to the divider', () => {
    useLayoutStore.setState({
      layout: { top: ['chat', 'files'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
    });
    const { container } = render(<SurfaceHost port={31415} />);

    const divider = container.querySelector('[data-testid="surf-divider-x"]') as HTMLElement | null;
    expect(divider?.style.width).toBe('9px');
  });
});

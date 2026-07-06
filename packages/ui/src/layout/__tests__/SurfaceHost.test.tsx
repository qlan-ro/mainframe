/**
 * SurfaceHost — workspace-inset + gutter wiring from windowStyleGeometry
 * (finding 15.2/15.6/15.10: the floating surface cards need a per-window-style
 * side/bottom margin and divider gutter, not hardcoded values).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { useTheme } from '@/store/theme';

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

describe('SurfaceHost — workspace inset', () => {
  it('applies the unified workspaceInset padding classes to the outer wrapper', () => {
    useTheme.getState().setWindowStyle('unified');
    render(<SurfaceHost port={31415} />);

    const outer = screen.getByTestId('chat-thread-area');
    expect(outer.className).toContain('pt-[4px]');
    expect(outer.className).toContain('px-[10px]');
    expect(outer.className).toContain('pb-[10px]');
  });

  it('applies the glass workspaceInset padding classes to the outer wrapper', () => {
    useTheme.getState().setWindowStyle('glass');
    render(<SurfaceHost port={31415} />);

    const outer = screen.getByTestId('chat-thread-area');
    expect(outer.className).toContain('pt-[4px]');
    expect(outer.className).toContain('px-[4px]');
    expect(outer.className).toContain('pb-0');
  });

  it('applies no extra inset classes for split', () => {
    useTheme.getState().setWindowStyle('split');
    render(<SurfaceHost port={31415} />);

    const outer = screen.getByTestId('chat-thread-area');
    expect(outer.className).not.toContain('pt-[4px]');
  });
});

describe('SurfaceHost — single-column spacer gutter', () => {
  it('uses the window-style gutter width for the single-column top-row spacer', () => {
    useLayoutStore.setState({
      layout: { top: ['chat', 'files'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 1 } },
    });
    useTheme.getState().setWindowStyle('split');
    const { container } = render(<SurfaceHost port={31415} />);

    // twoCol path uses SurfDivider (data-testid), which we already cover elsewhere;
    // this test only exists to prove the wrapper wires geo.gutter through, verified
    // via the SurfDivider width style it renders.
    const divider = container.querySelector('[data-testid="surf-divider-x"]') as HTMLElement | null;
    expect(divider?.style.width).toBe('9px');
  });
});

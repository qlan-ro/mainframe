/**
 * SurfaceHost — the workspace reports its resting left edge for the title bar,
 * takes its share of the row, and slides in and out beside the chat (W4).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { useWorkspaceSlide } from '@/store/workspace-slide';

vi.mock('@/features/sessions/new-thread/ChatSurface', () => ({
  ChatSurface: () => <div data-testid="chat-surface-stub" />,
}));
vi.mock('../surfaces/WorkspaceSurface', () => ({
  WorkspaceSurface: ({ leaving }: { leaving?: boolean }) => (
    <div data-testid="workspace-surface-stub" data-leaving={leaving} />
  ),
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

const place = (top: ('chat' | 'workspace')[], topFlex: Partial<Record<'chat' | 'workspace', number>> = {}) =>
  useLayoutStore.setState({ layout: { top, topFlex } });
const workspace = () => document.querySelector<HTMLElement>('[data-surface="workspace"]');
const slide = () => workspace()?.dataset.slide ?? null;

beforeEach(() => {
  useLayoutStore.setState({ layout: { top: ['chat'], topFlex: {} }, activeSessionId: 'chat-1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SurfaceHost — workspace edge', () => {
  it('reports the edge while the workspace sits beside the chat', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    expect(useColumnEdges.getState().workspace).toBe(0);
  });

  it('reports none while it is alone', () => {
    place(['workspace']);
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

describe('SurfaceHost — share of the row', () => {
  const share = () => workspace()?.parentElement?.style.getPropertyValue('--mf-workspace-frac');

  it('gives the workspace half the row until it is dragged', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    expect(share()).toBe('0.5');
    act(() => useLayoutStore.getState().setTopFrac(0.3));
    expect(share()).toBe('0.7');
  });

  it('gives the survivor the whole row', () => {
    place(['workspace'], { chat: 0.3, workspace: 0.7 });
    render(<SurfaceHost />);
    expect(workspace()).toHaveClass('flex-1');
    expect(screen.queryByTestId('surf-divider-x')).toBeNull();
  });
});

describe('SurfaceHost — slide (W4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  it('slides in beside the chat and settles', () => {
    render(<SurfaceHost />);
    act(() => place(['chat', 'workspace']));
    expect(slide()).toBe('opening');
    expect(useWorkspaceSlide.getState().sliding).toBe(true);

    act(() => vi.advanceTimersByTime(320));
    expect(slide()).toBe('open');
    expect(useWorkspaceSlide.getState().sliding).toBe(false);
  });

  it('slides out before it leaves, inert and without the empty state', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    act(() => place(['chat']));
    expect(slide()).toBe('closing');
    expect(workspace()).toHaveAttribute('inert');
    expect(screen.getByTestId('workspace-surface-stub')).toHaveAttribute('data-leaving', 'true');

    act(() => vi.advanceTimersByTime(320));
    expect(workspace()).toBeNull();
  });

  it('turns around when it is reopened on its way out', () => {
    place(['chat', 'workspace']);
    render(<SurfaceHost />);
    act(() => place(['chat']));
    act(() => vi.advanceTimersByTime(100));
    act(() => place(['chat', 'workspace']));
    expect(slide()).toBe('opening');
    act(() => vi.advanceTimersByTime(320));
    expect(slide()).toBe('open');
  });

  it('does not slide when another session brings its own layout', () => {
    render(<SurfaceHost />);
    act(() =>
      useLayoutStore.setState({ layout: { top: ['chat', 'workspace'], topFlex: {} }, activeSessionId: 'chat-2' }),
    );
    expect(slide()).toBe('open');
  });

  it('does not slide when the chat comes back as the workspace goes', () => {
    place(['workspace']);
    render(<SurfaceHost />);
    act(() => place(['chat']));
    expect(workspace()).toBeNull();
  });

  it('does not slide under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<SurfaceHost />);
    act(() => place(['chat', 'workspace']));
    expect(slide()).toBe('open');
    act(() => place(['chat']));
    expect(workspace()).toBeNull();
  });

  describe('with the divider', () => {
    const divider = () => screen.getByTestId('surf-divider-x');
    const frac = () => useLayoutStore.getState().layout.topFlex.workspace;
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 1000 }));
    });
    afterEach(() => vi.restoreAllMocks());
    const moveTo = (clientX: number) =>
      act(() => void window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX })));

    it('stops for a drag, which the panel then follows', () => {
      render(<SurfaceHost />);
      act(() => place(['chat', 'workspace']));
      expect(slide()).toBe('opening');

      fireEvent.pointerDown(divider());
      expect(slide()).toBe('open');
      expect(workspace()).toHaveClass('transition-none');
      expect(useWorkspaceSlide.getState().sliding).toBe(false);

      moveTo(400);
      expect(frac()).toBeCloseTo(0.6);
      expect(slide()).toBe('open');
    });

    it('stops for an arrow key', () => {
      render(<SurfaceHost />);
      act(() => place(['chat', 'workspace']));
      fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the workspace' }), { key: 'ArrowLeft' });
      expect(slide()).toBe('open');
    });

    it('lets a closing panel go on closing', () => {
      place(['chat', 'workspace']);
      render(<SurfaceHost />);
      act(() => place(['chat']));
      fireEvent.pointerDown(divider());
      expect(slide()).toBe('closing');
    });
  });
});

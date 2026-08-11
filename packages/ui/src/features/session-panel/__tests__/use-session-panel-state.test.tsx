/**
 * useSessionPanelState — the mode machine and the panel/section open state.
 * The light-dismiss suite lives in use-session-panel-dismiss.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSessionPanelState } from '../use-session-panel-state';
import { installPanelHarness, renderPanelState, setWidth, type PanelHarness } from './panel-state-harness';

let h: PanelHarness;

beforeEach(() => {
  h = installPanelHarness();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSessionPanelState — mode', () => {
  it('observes the host row, not the panel root', () => {
    renderPanelState();
    expect(h.observed).toEqual([h.host]);
  });

  // Regression: the packaged app's cold boot renders the initializing branch
  // first, so the host row mounts on a LATER commit than the hook. The old
  // []-deps effect read a null RefObject once and never retried — the panel
  // stayed permanently hidden in every release build.
  it('attaches the observer when the host mounts after the hook (cold-boot race)', () => {
    const rendered = renderHook(() => useSessionPanelState());
    expect(h.observed).toEqual([]);
    expect(rendered.result.current.mode).toBe('hidden');

    act(() => rendered.result.current.hostRef(h.host));
    expect(h.observed).toEqual([h.host]);
    setWidth(1000);
    expect(rendered.result.current.mode).toBe('rail');
  });

  it('re-attaches to a replacement host and disconnects from the old one', () => {
    const rendered = renderPanelState();
    const nextHost = document.createElement('div');
    document.body.append(nextHost);
    act(() => rendered.result.current.hostRef(nextHost));
    expect(h.observed).toEqual([h.host, nextHost]);
  });

  it('starts in rail mode on a narrow surface', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    expect(result.current.mode).toBe('rail');
    expect(result.current.surfaceWidth).toBe(1000);
  });

  it('sits inline on a wide surface', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
  });

  it('keeps the rail at a very narrow width — the rail has no minimum', () => {
    const { result } = renderPanelState();
    setWidth(800);
    expect(result.current.mode).toBe('rail');
    setWidth(400);
    expect(result.current.mode).toBe('rail');
  });

  it('drops the overlay when the surface grows back to inline', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel('session'));
    expect(result.current.mode).toBe('overlay');
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
    // …and it does not come back when the surface narrows again.
    setWidth(1000);
    expect(result.current.mode).toBe('rail');
  });

  it('keeps a floated stack while the surface stays short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel('session'));
    setWidth(800);
    expect(result.current.mode).toBe('overlay');
  });
});

describe('useSessionPanelState — panel open state', () => {
  it('reads the ui-prefs defaults: the session card alone', () => {
    const { result } = renderPanelState();
    expect(result.current.isPanelOpen('session')).toBe(true);
    expect(result.current.isPanelOpen('activity')).toBe(false);
    expect(result.current.isPanelOpen('launch')).toBe(false);
    expect(result.current.isPanelOpen('tasks')).toBe(false);
  });

  it('counts an open panel as visible only while the stack is showing', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.isPanelVisible('session')).toBe(true);
    // Rail-only: the bit is still open, but nothing is on screen.
    setWidth(1000);
    expect(result.current.isPanelOpen('session')).toBe(true);
    expect(result.current.isPanelVisible('session')).toBe(false);
  });

  it('never counts a closed panel as visible, however wide the surface', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.isPanelVisible('tasks')).toBe(false);
  });

  it('re-opens the session card on boot when the gutter fits, over a persisted close', () => {
    act(() => useUiPrefs.setState({ sessionPanelOpen: { session: false } }));
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.isPanelOpen('session')).toBe(true);
  });

  it('honours a close made during the run — boot-open arms only once', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.togglePanel('session'));
    expect(result.current.isPanelOpen('session')).toBe(false);
    // The gutter re-fitting later must not resurrect it this run.
    setWidth(1000);
    setWidth(1600);
    expect(result.current.isPanelOpen('session')).toBe(false);
  });
});

describe('useSessionPanelState — togglePanel', () => {
  it('closes an open panel on a wide surface, and writes it through', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.togglePanel('session'));
    expect(result.current.isPanelOpen('session')).toBe(false);
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(false);
    expect(result.current.mode).toBe('inline');
  });

  it('opens a closed panel on a wide surface without floating anything', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.togglePanel('tasks'));
    expect(useUiPrefs.getState().sessionPanelOpen.tasks).toBe(true);
    expect(result.current.mode).toBe('inline');
  });

  // The click asked to SEE the panel: an open-but-hidden panel floats rather
  // than silently closing, which would look like the button did nothing.
  it('reveals an open panel instead of closing it when the gutter is short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel('session'));
    expect(result.current.mode).toBe('overlay');
    expect(result.current.isPanelOpen('session')).toBe(true);
    expect(useUiPrefs.getState().sessionPanelOpen).toEqual({});
  });

  it('closes the panel on the second short-gutter click, once the stack is floating', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel('session'));
    act(() => result.current.togglePanel('session'));
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(false);
    expect(result.current.isPanelVisible('session')).toBe(false);
  });

  it('opens a closed panel AND floats the stack when the gutter is short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel('activity'));
    expect(useUiPrefs.getState().sessionPanelOpen.activity).toBe(true);
    expect(result.current.mode).toBe('overlay');
    expect(result.current.isPanelVisible('activity')).toBe(true);
  });
});

describe('useSessionPanelState — openPanel', () => {
  it('is idempotent — a second call never closes what it opened', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.openPanel('session'));
    act(() => result.current.openPanel('session'));
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(true);
    expect(result.current.isPanelOpen('session')).toBe(true);
  });

  it('floats the stack when the gutter is short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.openPanel('tasks'));
    expect(useUiPrefs.getState().sessionPanelOpen.tasks).toBe(true);
    expect(result.current.mode).toBe('overlay');
  });

  it('leaves an inline stack inline', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.openPanel('launch'));
    expect(result.current.mode).toBe('inline');
  });
});

describe('useSessionPanelState — section open state', () => {
  it('reads the ui-prefs defaults: Context open, Plan collapsed', () => {
    const { result } = renderPanelState();
    expect(result.current.isSectionOpen('context')).toBe(true);
    expect(result.current.isSectionOpen('plan')).toBe(false);
  });

  it('toggleSection writes through to ui-prefs', () => {
    const { result } = renderPanelState();
    act(() => result.current.toggleSection('plan'));
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(true);
    expect(result.current.isSectionOpen('plan')).toBe(true);
    act(() => result.current.toggleSection('plan'));
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(false);
  });

  it('expandSection is idempotent — navigating twice never collapses the target', () => {
    const { result } = renderPanelState();
    act(() => result.current.expandSection('plan'));
    act(() => result.current.expandSection('plan'));
    expect(result.current.isSectionOpen('plan')).toBe(true);
  });
});

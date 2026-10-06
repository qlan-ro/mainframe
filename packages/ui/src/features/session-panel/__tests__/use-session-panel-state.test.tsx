/**
 * useSessionPanelState — the mode machine and the panel/section open state.
 * The light-dismiss suite lives in use-session-panel-dismiss.test.tsx.
 *
 * D8: the whole panel is ONE boolean now (no per-card id) — isPanelOpen(),
 * isPanelVisible() and togglePanel() all take no argument.
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
    expect(rendered.result.current.mode).toBe('hidden');
  });

  it('re-attaches to a replacement host and disconnects from the old one', () => {
    const rendered = renderPanelState();
    const nextHost = document.createElement('div');
    document.body.append(nextHost);
    act(() => rendered.result.current.hostRef(nextHost));
    expect(h.observed).toEqual([h.host, nextHost]);
  });

  it('starts hidden on a narrow surface — no overlay has been asked for', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    expect(result.current.mode).toBe('hidden');
    expect(result.current.surfaceWidth).toBe(1000);
  });

  it('sits inline on a wide surface', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
  });

  it('keeps hidden at a very narrow width — there is no minimum', () => {
    const { result } = renderPanelState();
    setWidth(800);
    expect(result.current.mode).toBe('hidden');
    setWidth(400);
    expect(result.current.mode).toBe('hidden');
  });

  it('drops the overlay when the surface grows back to inline', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel());
    expect(result.current.mode).toBe('overlay');
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
    // …and it does not come back when the surface narrows again.
    setWidth(1000);
    expect(result.current.mode).toBe('hidden');
  });

  it('keeps a floated stack while the surface stays short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel());
    setWidth(800);
    expect(result.current.mode).toBe('overlay');
  });
});

describe('useSessionPanelState — panel open state (D8: one bit for the whole panel)', () => {
  it('reads the ui-prefs default: open', () => {
    const { result } = renderPanelState();
    expect(result.current.isPanelOpen()).toBe(true);
  });

  it('counts an open panel as visible only while the stack is showing', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.isPanelVisible()).toBe(true);
    // Rail-only: the bit is still open, but nothing is on screen.
    setWidth(1000);
    expect(result.current.isPanelOpen()).toBe(true);
    expect(result.current.isPanelVisible()).toBe(false);
  });

  it('a closed panel is never visible, however wide the surface', () => {
    const { result } = renderPanelState();
    // Widen first so the boot-open effect (fires once, the first time the
    // gutter fits) has already settled before the explicit close below.
    setWidth(1600);
    act(() => result.current.togglePanel());
    expect(result.current.isPanelOpen()).toBe(false);
    expect(result.current.isPanelVisible()).toBe(false);
  });

  it('re-opens the panel on boot when the gutter fits, over a persisted close', () => {
    act(() => useUiPrefs.setState({ sessionPanelOpen: false }));
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.isPanelOpen()).toBe(true);
  });

  it('honours a close made during the run — boot-open arms only once', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.togglePanel());
    expect(result.current.isPanelOpen()).toBe(false);
    // The gutter re-fitting later must not resurrect it this run.
    setWidth(1000);
    setWidth(1600);
    expect(result.current.isPanelOpen()).toBe(false);
  });
});

describe('useSessionPanelState — togglePanel', () => {
  it('closes an open panel on a wide surface, and writes it through — mode goes hidden, not rail', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.togglePanel());
    expect(result.current.isPanelOpen()).toBe(false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    expect(result.current.mode).toBe('hidden');
  });

  it('opens a closed panel on a wide surface without floating anything', () => {
    const { result } = renderPanelState();
    // Widen first so the boot-open effect has already settled, then close
    // explicitly before testing the re-open.
    setWidth(1600);
    act(() => result.current.togglePanel());
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    act(() => result.current.togglePanel());
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(result.current.mode).toBe('inline');
  });

  // The click asked to SEE the panel: an open-but-hidden panel floats rather
  // than silently closing, which would look like the button did nothing.
  it('reveals an open panel instead of closing it when the gutter is short', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel());
    expect(result.current.mode).toBe('overlay');
    expect(result.current.isPanelOpen()).toBe(true);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
  });

  it('closes the panel on the second short-gutter click, once the stack is floating', () => {
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel());
    act(() => result.current.togglePanel());
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    expect(result.current.isPanelVisible()).toBe(false);
  });

  it('opens a closed panel AND floats the stack when the gutter is short', () => {
    act(() => useUiPrefs.setState({ sessionPanelOpen: false }));
    const { result } = renderPanelState();
    setWidth(1000);
    act(() => result.current.togglePanel());
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(result.current.mode).toBe('overlay');
    expect(result.current.isPanelVisible()).toBe(true);
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
});

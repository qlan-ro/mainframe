import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSessionPanelState } from '../use-session-panel-state';

// jsdom's global setup ships an inert ResizeObserver stub; this one hands the
// test the callback so a surface resize can actually be simulated.
type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;
let resize: ResizeCallback = () => {};
let observed: Element[] = [];

class ControllableResizeObserver {
  constructor(cb: ResizeCallback) {
    resize = cb;
  }
  observe(el: Element) {
    observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: HTMLDivElement;

/**
 * The hook measures `hostRef` and light-dismisses against `rootRef`. renderHook
 * renders no elements, so both refs are seeded during render — a ref is just a
 * box, and this is exactly what React would have put there before the effects run.
 */
function renderPanelState() {
  return renderHook(() => {
    const state = useSessionPanelState();
    state.hostRef.current = host;
    state.rootRef.current = root;
    return state;
  });
}

function setWidth(width: number) {
  act(() => resize([{ contentRect: { width } }]));
}

beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ControllableResizeObserver;
  observed = [];
  host = document.createElement('div');
  root = document.createElement('div');
  document.body.append(host, root);
  // The store is a module-level singleton: an expansion or a collapse written by
  // one case would otherwise leak into the next.
  useUiPrefs.setState({ sessionPanelSections: {}, sessionPanelCollapsed: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSessionPanelState — mode', () => {
  it('observes the host row, not the panel root', () => {
    renderPanelState();
    expect(observed).toEqual([host]);
  });

  it('starts in rail mode on a narrow surface', () => {
    const { result } = renderPanelState();
    setWidth(800);
    expect(result.current.mode).toBe('rail');
    expect(result.current.surfaceWidth).toBe(800);
  });

  it('sits inline on a wide surface', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
  });

  it('drops the overlay when the surface grows back to inline', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('activity'));
    expect(result.current.mode).toBe('overlay');
    setWidth(1600);
    expect(result.current.mode).toBe('inline');
    // …and it does not come back when the surface narrows again.
    setWidth(800);
    expect(result.current.mode).toBe('rail');
  });

  it('collapses a wide surface to the rail, and records it', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.collapsePanel());
    expect(result.current.mode).toBe('rail');
    expect(useUiPrefs.getState().sessionPanelCollapsed).toBe(true);
  });

  it('honours a collapse persisted from a previous session', () => {
    useUiPrefs.setState({ sessionPanelCollapsed: true });
    const { result } = renderPanelState();
    setWidth(1600);
    expect(result.current.mode).toBe('rail');
  });

  it('a rail click on a wide surface returns to inline, never to the overlay', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.collapsePanel());
    act(() => result.current.selectSection('launch'));
    expect(result.current.mode).toBe('inline');
    expect(useUiPrefs.getState().sessionPanelCollapsed).toBe(false);
    // …and it still scrolled to what was clicked.
    expect(result.current.focusRequest).toEqual({ id: 'launch', seq: 1 });
  });

  it('keeps the collapse when the surface narrows and widens again', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.collapsePanel());
    setWidth(800);
    expect(result.current.mode).toBe('rail');
    setWidth(1600);
    expect(result.current.mode).toBe('rail');
  });

  it('drops a floating panel when the gutter opens back up, even while collapsed', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('activity'));
    expect(result.current.mode).toBe('overlay');
    act(() => result.current.collapsePanel());
    setWidth(1600);
    expect(result.current.mode).toBe('rail');
    // The stale overlay must not resurface when the surface narrows again.
    setWidth(800);
    expect(result.current.mode).toBe('rail');
  });
});

describe('useSessionPanelState — section open state', () => {
  it('reads the ui-prefs defaults: Context open, the rest collapsed', () => {
    const { result } = renderPanelState();
    expect(result.current.isSectionOpen('context')).toBe(true);
    expect(result.current.isSectionOpen('plan')).toBe(false);
    expect(result.current.isSectionOpen('activity')).toBe(false);
    expect(result.current.isSectionOpen('launch')).toBe(false);
  });

  it('treats Summary as always open — it has no collapse control', () => {
    const { result } = renderPanelState();
    expect(result.current.isSectionOpen('summary')).toBe(true);
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

describe('useSessionPanelState — selectSection', () => {
  it('floats the panel and expands the target when rail-only', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('launch'));
    expect(result.current.mode).toBe('overlay');
    expect(result.current.isSectionOpen('launch')).toBe(true);
    expect(result.current.focusRequest).toEqual({ id: 'launch', seq: 1 });
  });

  it('persists the expansion — the section you navigate to stays open next session', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('launch'));
    expect(useUiPrefs.getState().sessionPanelSections.launch).toBe(true);
  });

  it('does not float the panel when it is already inline', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.selectSection('plan'));
    expect(result.current.mode).toBe('inline');
    expect(result.current.isSectionOpen('plan')).toBe(true);
  });

  it('is idempotent on an open section — a second inline click never collapses it', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.selectSection('activity'));
    act(() => result.current.selectSection('activity'));
    expect(result.current.isSectionOpen('activity')).toBe(true);
    expect(useUiPrefs.getState().sessionPanelSections.activity).toBe(true);
  });

  it('bumps the focus sequence on every click so re-clicking scrolls again', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    act(() => result.current.selectSection('context'));
    expect(result.current.focusRequest).toEqual({ id: 'context', seq: 1 });
    act(() => result.current.selectSection('context'));
    expect(result.current.focusRequest).toEqual({ id: 'context', seq: 2 });
  });

  it('closes a floating panel that is already showing the clicked section', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('activity'));
    expect(result.current.mode).toBe('overlay');
    act(() => result.current.selectSection('activity'));
    expect(result.current.mode).toBe('rail');
    // Closing the overlay must not collapse what it was showing.
    expect(result.current.isSectionOpen('activity')).toBe(true);
  });

  it('re-points a floating panel at a different section without closing it', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('activity'));
    act(() => result.current.selectSection('context'));
    expect(result.current.mode).toBe('overlay');
    expect(result.current.focusRequest).toEqual({ id: 'context', seq: 2 });
  });

  it('accepts Summary, which floats the panel without writing a pref', () => {
    const { result } = renderPanelState();
    setWidth(800);
    act(() => result.current.selectSection('summary'));
    expect(result.current.mode).toBe('overlay');
    expect(useUiPrefs.getState().sessionPanelSections).toEqual({});
  });
});

describe('useSessionPanelState — section scroll registry', () => {
  it('scrolls a registered section into view when it is selected', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    const section = document.createElement('div');
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    act(() => result.current.registerSection('context')(section));
    act(() => result.current.selectSection('context'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a section that unregistered itself', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    const section = document.createElement('div');
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    act(() => result.current.registerSection('plan')(section));
    act(() => result.current.registerSection('plan')(null));
    act(() => result.current.selectSection('plan'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('useSessionPanelState — light dismiss', () => {
  function openOverlay() {
    const rendered = renderPanelState();
    setWidth(800);
    act(() => rendered.result.current.selectSection('activity'));
    return rendered;
  }

  function pointerDownOn(target: Element) {
    act(() => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
  }

  function escapeOn(target: EventTarget, init: KeyboardEventInit = {}) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
    });
  }

  it('closes on a pointerdown outside the panel', () => {
    const { result } = openOverlay();
    const outside = document.createElement('div');
    document.body.append(outside);
    pointerDownOn(outside);
    expect(result.current.mode).toBe('rail');
  });

  it('stays open for a pointerdown inside the panel', () => {
    const { result } = openOverlay();
    const inside = document.createElement('button');
    root.append(inside);
    pointerDownOn(inside);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a portalled menu', () => {
    const { result } = openOverlay();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    menu.append(item);
    document.body.append(menu);
    pointerDownOn(item);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a Radix popper wrapper', () => {
    const { result } = openOverlay();
    const popper = document.createElement('div');
    popper.setAttribute('data-radix-popper-content-wrapper', '');
    document.body.append(popper);
    pointerDownOn(popper);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a portalled dialog', () => {
    const { result } = openOverlay();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    pointerDownOn(dialog);
    expect(result.current.mode).toBe('overlay');
  });

  it('closes on Escape', () => {
    const { result } = openOverlay();
    escapeOn(document);
    expect(result.current.mode).toBe('rail');
  });

  it('ignores an Escape another handler already consumed', () => {
    const { result } = openOverlay();
    const consumer = (e: Event) => e.preventDefault();
    // Capture-phase on document, dispatched from a descendant, so the consumer
    // provably runs before the hook's bubble-phase listener.
    document.addEventListener('keydown', consumer, true);
    escapeOn(root);
    document.removeEventListener('keydown', consumer, true);
    expect(result.current.mode).toBe('overlay');
  });

  it('ignores Escape while a Radix dialog is open, so the dialog keeps its own key', () => {
    const { result } = openOverlay();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(dialog);
    escapeOn(document);
    expect(result.current.mode).toBe('overlay');
  });

  it('ignores keys other than Escape', () => {
    const { result } = openOverlay();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(result.current.mode).toBe('overlay');
  });

  it('does not listen while the panel is inline', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    const outside = document.createElement('div');
    document.body.append(outside);
    pointerDownOn(outside);
    escapeOn(document);
    expect(result.current.mode).toBe('inline');
  });
});

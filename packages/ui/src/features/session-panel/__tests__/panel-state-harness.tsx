/**
 * Shared harness for the useSessionPanelState suites (the state machine in one
 * file, light dismiss in another — together they exceed the 300-line cap).
 *
 * jsdom's global setup ships an inert ResizeObserver stub; this one hands the
 * test the callback so a surface resize can actually be simulated.
 */
import { renderHook, act } from '@testing-library/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSessionPanelState } from '../use-session-panel-state';

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;

export interface PanelHarness {
  /** The measured chat-surface row. */
  host: HTMLDivElement;
  /** The panel root light dismiss treats as "inside". */
  root: HTMLDivElement;
  /** Every element the hook's observer attached to, in order. */
  observed: Element[];
}

let harness: PanelHarness;
let resize: ResizeCallback = () => {};

class ControllableResizeObserver {
  constructor(cb: ResizeCallback) {
    resize = cb;
  }
  observe(el: Element) {
    harness.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

/** Call from `beforeEach`: fresh DOM nodes, a fresh observer, a reset store. */
export function installPanelHarness(): PanelHarness {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ControllableResizeObserver;
  const host = document.createElement('div');
  const root = document.createElement('div');
  document.body.append(host, root);
  harness = { host, root, observed: [] };
  // The store is a module-level singleton: an open panel or an expansion written
  // by one case would otherwise leak into the next.
  useUiPrefs.setState({ sessionPanelOpen: {}, sessionPanelSections: {} });
  return harness;
}

/**
 * The hook measures the host through its state-backed callback ref and
 * light-dismisses against `rootRef`. The host is attached AFTER mount — the
 * same order a cold boot produces (initializing branch first, row later), which
 * the old RefObject-seeded harness could not express and therefore never caught.
 */
export function renderPanelState() {
  const rendered = renderHook(() => {
    const state = useSessionPanelState();
    state.rootRef.current = harness.root;
    return state;
  });
  act(() => rendered.result.current.hostRef(harness.host));
  return rendered;
}

export function setWidth(width: number) {
  act(() => resize([{ contentRect: { width } }]));
}

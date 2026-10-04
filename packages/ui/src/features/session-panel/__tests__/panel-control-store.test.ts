// @vitest-environment jsdom
/**
 * panel-control-store — the session panel's transient per-column float state,
 * plus the togglePanel rule it shares with the persisted ui-prefs bit.
 *
 * D8: `overlayOpen` is keyed per column ('main' | 'zone:<id>') so two zones
 * never share a float; `sessionPanelOpen` itself lives in ui-prefs and is
 * shared across every column.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { usePanelControl, selectOverlayOpen, zoneColumnId } from '../panel-control-store';

beforeEach(() => {
  useUiPrefs.setState({ sessionPanelOpen: true });
  usePanelControl.setState({ overlayOpen: {} });
});

describe('zoneColumnId', () => {
  it('namespaces a zone id so it never collides with "main"', () => {
    expect(zoneColumnId('a')).toBe('zone:a');
  });
});

describe('overlayOpen — per-column independence', () => {
  it('defaults every column to not floating', () => {
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
    expect(selectOverlayOpen(zoneColumnId('a'))(usePanelControl.getState())).toBe(false);
  });

  it('setting one column floating leaves another column alone', () => {
    usePanelControl.getState().setOverlayOpen('main', true);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(true);
    expect(selectOverlayOpen(zoneColumnId('a'))(usePanelControl.getState())).toBe(false);
  });

  it('"main" and "zone:a" float independently even when both are set', () => {
    usePanelControl.getState().setOverlayOpen('main', true);
    usePanelControl.getState().setOverlayOpen(zoneColumnId('a'), true);
    usePanelControl.getState().setOverlayOpen('main', false);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
    expect(selectOverlayOpen(zoneColumnId('a'))(usePanelControl.getState())).toBe(true);
  });

  it('setOverlayOpen is a no-op (same state reference) when the value is unchanged', () => {
    const before = usePanelControl.getState();
    usePanelControl.getState().setOverlayOpen('main', false); // already false
    expect(usePanelControl.getState()).toBe(before);
  });

  it('setOverlayOpen DOES produce a new state when the value actually changes', () => {
    const before = usePanelControl.getState();
    usePanelControl.getState().setOverlayOpen('main', true);
    expect(usePanelControl.getState()).not.toBe(before);
  });
});

describe('togglePanel — the four-branch rule', () => {
  it("open + fits → closes the panel and clears this column's overlay", () => {
    useUiPrefs.setState({ sessionPanelOpen: true });
    usePanelControl.getState().setOverlayOpen('main', true); // stale float from an earlier narrow pass
    usePanelControl.getState().togglePanel('main', true);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
  });

  it('open + does not fit + not floating → floats only, panel stays open', () => {
    useUiPrefs.setState({ sessionPanelOpen: true });
    usePanelControl.getState().togglePanel('main', false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(true);
  });

  it('open + does not fit + already floating → closes the panel and un-floats', () => {
    useUiPrefs.setState({ sessionPanelOpen: true });
    usePanelControl.getState().setOverlayOpen('main', true);
    usePanelControl.getState().togglePanel('main', false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
  });

  it('closed + fits → opens, no overlay', () => {
    useUiPrefs.setState({ sessionPanelOpen: false });
    usePanelControl.getState().togglePanel('main', true);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
  });

  it('closed + does not fit → opens AND floats', () => {
    useUiPrefs.setState({ sessionPanelOpen: false });
    usePanelControl.getState().togglePanel('main', false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(true);
  });

  it('a zone column\'s toggle never touches the "main" column\'s overlay', () => {
    useUiPrefs.setState({ sessionPanelOpen: false });
    usePanelControl.getState().togglePanel(zoneColumnId('a'), false);
    expect(selectOverlayOpen(zoneColumnId('a'))(usePanelControl.getState())).toBe(true);
    expect(selectOverlayOpen('main')(usePanelControl.getState())).toBe(false);
  });
});

/**
 * SessionPanelToggle — unit tests.
 *
 * Each chat column owns its toggle: `'main'` (the single surface — its open bit
 * persists in ui-prefs) and `'zone:<id>'` (a split half — a transient override
 * that starts from the persisted bit). Toggling one column never moves another,
 * so the two halves of a split open their panels independently. The click goes
 * through `usePanelControl.togglePanel` with the column's measured `fits`.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { usePanelControl, zoneColumnId, type PanelColumnId } from '../panel-control-store';
import { SessionPanelToggle } from '../SessionPanelToggle';

function renderToggles(columns: Array<{ columnId: PanelColumnId; testId: string; tourAnchor?: boolean }>) {
  return render(
    <TooltipProvider>
      {columns.map((c) => (
        <SessionPanelToggle key={c.testId} {...c} />
      ))}
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useUiPrefs.setState({ sessionPanelOpen: true });
  usePanelControl.setState({ open: {}, overlayOpen: {}, fits: {} });
});

describe('SessionPanelToggle — main column', () => {
  it('reflects and flips the persisted open bit', () => {
    renderToggles([{ columnId: 'main', testId: 'session-panel-toggle', tourAnchor: true }]);
    const toggle = screen.getByTestId('session-panel-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('data-tut', 'session-rail');

    fireEvent.click(toggle);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName('Show session details');
  });
});

describe('SessionPanelToggle — split halves are independent', () => {
  it('a zone starts from the persisted bit and toggles only itself', () => {
    renderToggles([
      { columnId: zoneColumnId('a'), testId: 'session-panel-toggle-a' },
      { columnId: zoneColumnId('b'), testId: 'session-panel-toggle-b' },
    ]);
    const a = screen.getByTestId('session-panel-toggle-a');
    const b = screen.getByTestId('session-panel-toggle-b');
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveAttribute('aria-pressed', 'true');
    // A zone's toggle never rewrites the single surface's persisted preference.
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(a).not.toHaveAttribute('data-tut');
  });

  it('opening a half that does not fit floats its panel, leaving the other half alone', () => {
    useUiPrefs.setState({ sessionPanelOpen: false });
    usePanelControl.setState({ fits: { [zoneColumnId('a')]: false } });
    renderToggles([
      { columnId: zoneColumnId('a'), testId: 'session-panel-toggle-a' },
      { columnId: zoneColumnId('b'), testId: 'session-panel-toggle-b' },
    ]);

    fireEvent.click(screen.getByTestId('session-panel-toggle-a'));
    const state = usePanelControl.getState();
    expect(state.open[zoneColumnId('a')]).toBe(true);
    expect(state.overlayOpen[zoneColumnId('a')]).toBe(true);
    expect(state.open[zoneColumnId('b')]).toBeUndefined();
    expect(state.overlayOpen[zoneColumnId('b')]).toBeUndefined();
  });
});

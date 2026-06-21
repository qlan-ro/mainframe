import { beforeEach, describe, expect, it } from 'vitest';
import {
  useBottomPanel,
  clampBottomPanelHeight,
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
} from '../bottom-panel';

describe('bottom-panel store', () => {
  beforeEach(() => {
    localStorage.clear();
    useBottomPanel.setState({ tab: 'context', height: BOTTOM_PANEL_DEFAULT_HEIGHT });
  });

  it('defaults to the context tab and 280px height', () => {
    const s = useBottomPanel.getState();
    expect(s.tab).toBe('context');
    expect(s.height).toBe(280);
  });

  it('setTab updates the active tab', () => {
    useBottomPanel.getState().setTab('skills');
    expect(useBottomPanel.getState().tab).toBe('skills');
  });

  it('setHeight clamps below the minimum to 120', () => {
    useBottomPanel.getState().setHeight(40);
    expect(useBottomPanel.getState().height).toBe(120);
  });

  it('setHeight persists to localStorage', () => {
    useBottomPanel.getState().setHeight(300);
    expect(localStorage.getItem('mf.bottomPanel.height')).toBe('300');
  });

  it('clampBottomPanelHeight clamps to [120, maxHeight]', () => {
    expect(clampBottomPanelHeight(50, 500)).toBe(BOTTOM_PANEL_MIN_HEIGHT);
    expect(clampBottomPanelHeight(900, 500)).toBe(500);
    expect(clampBottomPanelHeight(250, 500)).toBe(250);
  });
});

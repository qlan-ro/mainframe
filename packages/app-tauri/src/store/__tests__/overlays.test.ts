import { describe, it, expect, beforeEach } from 'vitest';
import { useOverlaysStore } from '../overlays';

beforeEach(() => {
  useOverlaysStore.setState({ paletteOpen: false, findInPath: null, reviewOpen: false });
});

describe('useOverlaysStore', () => {
  it('toggles paletteOpen', () => {
    useOverlaysStore.getState().setPaletteOpen(true);
    expect(useOverlaysStore.getState().paletteOpen).toBe(true);
    useOverlaysStore.getState().setPaletteOpen(false);
    expect(useOverlaysStore.getState().paletteOpen).toBe(false);
  });

  it('sets and clears findInPath scope', () => {
    useOverlaysStore.getState().setFindInPath({ scopePath: 'src', scopeType: 'directory' });
    expect(useOverlaysStore.getState().findInPath).toEqual({ scopePath: 'src', scopeType: 'directory' });
    useOverlaysStore.getState().setFindInPath(null);
    expect(useOverlaysStore.getState().findInPath).toBeNull();
  });

  it('toggles reviewOpen', () => {
    useOverlaysStore.getState().setReviewOpen(true);
    expect(useOverlaysStore.getState().reviewOpen).toBe(true);
  });
});

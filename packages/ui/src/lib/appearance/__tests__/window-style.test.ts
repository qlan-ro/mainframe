import { describe, it, expect } from 'vitest';
import { windowStyleGeometry } from '../window-style';
import type { WindowStyle } from '@/store/theme';

const STYLES: WindowStyle[] = ['unified', 'split', 'glass'];

// The per-style class strings are design data; asserting them verbatim just
// mirrors the WINDOW_STYLE_GEOMETRY constant. Only the structural contract
// (every style defines every site) is pinned here.
describe('windowStyleGeometry', () => {
  it('defines all sites for every style', () => {
    for (const s of STYLES) {
      const g = windowStyleGeometry(s);
      expect(g.windowRoot).toBeTruthy();
      expect(g.sidebar).toBeTruthy();
      expect(g.pane).toBeTruthy();
      expect(g.divider).toBeTruthy();
      expect(g.toolbar).toBeTruthy();
      expect(typeof g.workspaceInset).toBe('string');
      expect(typeof g.gutter).toBe('number');
    }
  });
});

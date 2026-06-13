import { describe, it, expect } from 'vitest';
import { windowStyleGeometry, WINDOW_STYLE_GEOMETRY } from '../window-style';
import type { WindowStyle } from '@/store/theme';

const STYLES: WindowStyle[] = ['unified', 'split', 'glass'];

describe('windowStyleGeometry', () => {
  it('defines all five sites for every style', () => {
    for (const s of STYLES) {
      const g = windowStyleGeometry(s);
      expect(g.windowRoot).toBeTruthy();
      expect(g.sidebar).toBeTruthy();
      expect(g.pane).toBeTruthy();
      expect(g.divider).toBeTruthy();
      expect(g.toolbar).toBeTruthy();
    }
  });

  it('split fills the window with --background and split panes are square', () => {
    expect(WINDOW_STYLE_GEOMETRY.split.windowRoot).toContain('bg-background');
    expect(WINDOW_STYLE_GEOMETRY.split.pane).toContain('rounded-none');
  });

  it('glass keeps the frosted sidebar; unified is flat/transparent', () => {
    expect(WINDOW_STYLE_GEOMETRY.glass.sidebar).toContain('bg-mf-glass');
    expect(WINDOW_STYLE_GEOMETRY.unified.sidebar).toContain('bg-transparent');
  });
});

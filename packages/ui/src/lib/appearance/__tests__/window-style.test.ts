import { describe, it, expect } from 'vitest';
import { windowStyleGeometry, WINDOW_STYLE_GEOMETRY } from '../window-style';
import type { WindowStyle } from '@/store/theme';

const STYLES: WindowStyle[] = ['unified', 'split', 'glass'];

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

  it('split fills the window with --background and split panes are square', () => {
    expect(WINDOW_STYLE_GEOMETRY.split.windowRoot).toContain('bg-background');
    expect(WINDOW_STYLE_GEOMETRY.split.pane).toContain('rounded-none');
  });

  it('glass keeps the frosted sidebar; unified is flat/transparent', () => {
    expect(WINDOW_STYLE_GEOMETRY.glass.sidebar).toContain('bg-mf-glass');
    expect(WINDOW_STYLE_GEOMETRY.unified.sidebar).toContain('bg-transparent');
  });

  it('unified has zero window-level pad/gap; its floating-card inset comes from workspaceInset', () => {
    expect(WINDOW_STYLE_GEOMETRY.unified.windowRoot).toContain('p-0');
    expect(WINDOW_STYLE_GEOMETRY.unified.windowRoot).toContain('gap-0');
    expect(WINDOW_STYLE_GEOMETRY.unified.workspaceInset).toContain('px-[10px]');
    expect(WINDOW_STYLE_GEOMETRY.unified.workspaceInset).toContain('pb-[10px]');
  });

  it('glass layers a 4px top/side workspace inset on top of its 7px window pad/gap', () => {
    expect(WINDOW_STYLE_GEOMETRY.glass.windowRoot).toContain('p-[7px]');
    expect(WINDOW_STYLE_GEOMETRY.glass.workspaceInset).toContain('pt-[4px]');
    expect(WINDOW_STYLE_GEOMETRY.glass.workspaceInset).toContain('px-[4px]');
    expect(WINDOW_STYLE_GEOMETRY.glass.workspaceInset).toContain('pb-0');
  });

  it('split has no workspace inset (flush square panes)', () => {
    expect(WINDOW_STYLE_GEOMETRY.split.workspaceInset).toBe('');
  });

  it('gutter is 8px for unified/glass and 9px for split', () => {
    expect(WINDOW_STYLE_GEOMETRY.unified.gutter).toBe(8);
    expect(WINDOW_STYLE_GEOMETRY.glass.gutter).toBe(8);
    expect(WINDOW_STYLE_GEOMETRY.split.gutter).toBe(9);
  });

  it('unified and glass surfaces use distinct ambient-shadow tokens (15.7)', () => {
    expect(WINDOW_STYLE_GEOMETRY.unified.surface).toContain('shadow-[var(--mf-shadow-panel-ambient)]');
    expect(WINDOW_STYLE_GEOMETRY.glass.surface).toContain('shadow-[var(--mf-shadow-panel-glass-ambient)]');
  });
});

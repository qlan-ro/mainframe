import type { WindowStyle } from '@/store/theme';

export interface WindowStyleGeometry {
  /** AppShell RuntimeBody root: window backdrop + padding + inter-panel gap. */
  windowRoot: string;
  /** SidebarShell outer panel. */
  sidebar: string;
  /** AppShell main-surface pane — a transparent column for the floating styles
   *  (the MainToolbar sits on the window background, NOT inside a white card). */
  pane: string;
  /** Per-surface card inside SurfaceHost — the rounded floating card (prototype
   *  04-engine `surfCard`). Each surface, not the toolbar, owns the rounding. */
  surface: string;
  /** SurfDivider treatment between stacked surfaces. */
  divider: string;
  /** MainToolbar band. */
  toolbar: string;
}

/**
 * Per-window-style geometry fragments (component-map §8.3). Color/typography come
 * from the theme tokens; this is structure only. `glass` is the default and
 * reproduces the prototype's exact glass artboard (7px window pad/gap).
 */
export const WINDOW_STYLE_GEOMETRY: Record<WindowStyle, WindowStyleGeometry> = {
  unified: {
    windowRoot: 'bg-mf-window p-2 gap-2',
    sidebar: 'bg-transparent backdrop-blur-0 rounded-none shadow-none',
    pane: 'bg-transparent gap-2',
    surface: 'rounded-[10px] bg-background shadow-[var(--mf-shadow-panel)] ring-[0.5px] ring-border',
    divider: 'bg-transparent',
    toolbar: 'bg-transparent',
  },
  split: {
    windowRoot: 'bg-background p-0 gap-0',
    sidebar: 'bg-transparent backdrop-blur-0 rounded-none shadow-none [border-right:0.5px_solid_var(--border)]',
    pane: 'rounded-none bg-background shadow-none',
    surface: 'bg-background',
    divider: 'bg-border',
    toolbar: 'bg-background [border-bottom:0.5px_solid_var(--border)]',
  },
  glass: {
    windowRoot: 'bg-mf-window p-[7px] gap-[7px]',
    sidebar:
      'bg-mf-glass backdrop-blur-[40px] backdrop-saturate-[1.8] rounded-[13px] shadow-[var(--mf-shadow-panel-soft)]',
    pane: 'bg-transparent gap-[7px]',
    surface: 'rounded-[11px] bg-background shadow-[var(--mf-shadow-panel)]',
    divider: 'bg-transparent',
    toolbar: 'bg-transparent',
  },
};

export function windowStyleGeometry(style: WindowStyle): WindowStyleGeometry {
  return WINDOW_STYLE_GEOMETRY[style];
}

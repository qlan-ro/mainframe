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
  /** SurfaceHost outer wrapper — the WorkspaceArea inset applied below the
   *  toolbar, independent of the sidebar↔pane gap (04-engine `SHELL.pad`).
   *  Gives the floating surface cards their side/bottom margin from the window
   *  edge; the sidebar itself is NOT inset by this (finding 15.2/15.6). */
  workspaceInset: string;
  /** SurfDivider / single-column spacer gutter width in px (04-engine `SHELL.gutter`). */
  gutter: number;
}

/**
 * Per-window-style geometry fragments (component-map §8.3). Color/typography come
 * from the theme tokens; this is structure only. `glass` is the default and
 * reproduces the prototype's exact glass artboard (7px window pad/gap).
 */
export const WINDOW_STYLE_GEOMETRY: Record<WindowStyle, WindowStyleGeometry> = {
  unified: {
    // Window-level pad/gap is 0 — the sidebar sits flush against the window
    // edge and against the main column with zero gap (04-engine:777-781); the
    // floating-card inset comes from `workspaceInset` below instead.
    windowRoot: 'bg-mf-window p-0 gap-0',
    sidebar: 'bg-transparent backdrop-blur-0 rounded-none shadow-none',
    // Opaque (same colour as the window backdrop it sits on) so the pane slides
    // as a SOLID cover over the sidebar during a drag-collapse — otherwise the
    // transparent toolbar strip lets the sidebar header icons show through.
    pane: 'bg-mf-window gap-0',
    surface: 'rounded-[10px] bg-background shadow-[var(--mf-shadow-panel)] ring-[0.5px] ring-border',
    divider: 'bg-transparent',
    toolbar: 'bg-transparent',
    // SHELL.pad = '4px 10px 10px': 4px below the toolbar, 10px from the side/bottom edges.
    workspaceInset: 'pt-[4px] px-[10px] pb-[10px]',
    gutter: 8,
  },
  split: {
    windowRoot: 'bg-background p-0 gap-0',
    sidebar: 'bg-transparent backdrop-blur-0 rounded-none shadow-none [border-right:0.5px_solid_var(--border)]',
    pane: 'rounded-none bg-background shadow-none',
    surface: 'bg-background',
    divider: 'bg-border',
    toolbar: 'bg-background [border-bottom:0.5px_solid_var(--border)]',
    workspaceInset: '',
    gutter: 9,
  },
  glass: {
    windowRoot: 'bg-mf-window p-[7px] gap-[7px]',
    sidebar:
      'bg-mf-glass backdrop-blur-[40px] backdrop-saturate-[1.8] rounded-[13px] shadow-[var(--mf-shadow-panel-soft)]',
    // Opaque (same colour as the window backdrop) so the pane is a SOLID cover
    // over the sidebar during a drag-collapse — see the `unified` note above.
    pane: 'bg-mf-window gap-[7px]',
    surface: 'rounded-[11px] bg-background shadow-[var(--mf-shadow-panel)]',
    divider: 'bg-transparent',
    toolbar: 'bg-transparent',
    // Additional inset on top of the outer 7px window pad/gap: top/sides 4px,
    // flush at the bottom to align with the sidebar card's bottom edge (04-engine:787-791).
    workspaceInset: 'pt-[4px] px-[4px] pb-0',
    gutter: 8,
  },
};

export function windowStyleGeometry(style: WindowStyle): WindowStyleGeometry {
  return WINDOW_STYLE_GEOMETRY[style];
}

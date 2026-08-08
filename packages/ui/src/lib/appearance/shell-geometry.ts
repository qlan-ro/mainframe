/**
 * The one shell geometry — flat panels on the v2 token layer.
 *
 * The three window styles (glass / unified / split) went away with the warm
 * chrome; what remains is the flat shape the legacy islands (SurfaceHost,
 * InspectorPane) still consume. This shim dies with them: each island's port
 * replaces its fragment with the island's own markup.
 */
export const SHELL_GEOMETRY = {
  /** Per-surface pane inside SurfaceHost. */
  surface: 'bg-background',
  /** SurfDivider treatment between stacked surfaces. */
  divider: 'bg-border',
  /** SurfaceHost outer wrapper inset below the toolbar. */
  workspaceInset: '',
  /** SurfDivider / single-column spacer gutter width in px. */
  gutter: 9,
} as const;

/**
 * SessionGroupHeader — the label header for one time/status section in the
 * sessions list (Pinned / Today / Yesterday / Earlier / A–Z / By status).
 *
 * Rendered by the virtualized list (`SessionListVirtuoso`) as GroupedVirtuoso's
 * `groupContent`. GroupedVirtuoso owns the sticky positioning of the active
 * group header — not `sticky top-0` here. No background/blur of its own: it
 * sits directly on the sidebar panel's own glass (SidebarShell), same as every
 * row. The ONE case that needs an opaque backing — the sticky pinned copy, so
 * scrolled-under rows don't ghost through it — gets it from the Virtuoso
 * TopItemList wrapper (SessionListVirtuoso's SessionsTopItemList), not here.
 * Painting glass again on this element too would double the tint/blur only
 * for headers, visibly seaming them against the rows around them.
 *
 * No leading pin glyph on the "Pinned" label itself — not a macOS pattern
 * (Finder/Mail section headers are plain text). Individual pinned rows still
 * carry their own pin glyph when shown outside the Pinned group (SessionRow's
 * `custom.pinned && !inPinnedGroup`), which is the actual per-item indicator.
 */
import { sidebarIndentPx } from '@/layout/sidebar-indent';

export function SessionGroupHeader({ label }: { label: string }) {
  return (
    <div
      data-testid={`sessions-group-header-${label}`}
      style={{ paddingLeft: sidebarIndentPx(1) }}
      className="flex items-center gap-[4px] pb-[3px] pr-5 pt-[7px] text-caption font-medium text-muted-foreground"
    >
      {label}
    </div>
  );
}

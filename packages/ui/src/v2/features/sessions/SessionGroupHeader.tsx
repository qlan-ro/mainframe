/**
 * The header for one section of the sessions list (Pinned / Today / … ).
 *
 * These groups ARE the sidebar's session sections — there is no "Sessions"
 * section above them — so the label sits at the root indent alongside Projects
 * and Tasks, and the first group carries the controls that section header used
 * to own.
 *
 * `GroupedVirtuoso` owns the sticky positioning, so there is no `sticky top-0`
 * here — but the pinned copy does need to be opaque, or rows scrolling beneath
 * it ghost through. On v2's opaque panel that is just `bg-sidebar`.
 *
 * "Pinned" carries no pin glyph — Finder and Mail section headers are plain
 * text. The per-item indicator is the row's own glyph, shown when a pinned row
 * appears outside that group.
 */
import type { ReactNode } from 'react';
import { SidebarGroupLabel } from '@v2/components/ui/sidebar';

interface SessionGroupHeaderProps {
  label: string;
  /** Rendered on the first group only — the list's controls have one home. */
  actions?: ReactNode;
}

export function SessionGroupHeader({ label, actions }: SessionGroupHeaderProps) {
  return (
    <SidebarGroupLabel data-testid={`sessions-group-header-${label}`} className="h-7 bg-sidebar pr-1 pl-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actions != null && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
    </SidebarGroupLabel>
  );
}

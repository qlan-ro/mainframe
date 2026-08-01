/**
 * The label for one section of the sessions list (Pinned / Today / … ).
 *
 * `GroupedVirtuoso` owns the sticky positioning, so there is no `sticky top-0`
 * here — but the pinned copy does need to be opaque, or rows scrolling beneath
 * it ghost through. On v2's opaque panel that is just `bg-sidebar`: the same
 * colour it already sits on, so in-flow headers are unchanged and the shipped
 * glass-compositing workaround has nothing left to guard.
 *
 * "Pinned" carries no pin glyph — Finder and Mail section headers are plain
 * text. The per-item indicator is the row's own glyph, shown when a pinned row
 * appears outside that group.
 */
import { SidebarGroupLabel } from '@v2/components/ui/sidebar';

export function SessionGroupHeader({ label }: { label: string }) {
  return (
    <SidebarGroupLabel data-testid={`sessions-group-header-${label}`} className="h-7 bg-sidebar pl-2">
      {label}
    </SidebarGroupLabel>
  );
}

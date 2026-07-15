import { ChevronDown } from 'lucide-react';

/**
 * Disclosure chevron for a collapsible left-sidebar root section (Projects/
 * Sessions/Tasks/Tags). Points right when collapsed, down when expanded —
 * matches ContextSection's chevron convention (context-panel/ContextSection.tsx)
 * and the macOS disclosure-triangle direction.
 */
export function SidebarSectionChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      size={12}
      aria-hidden
      className={`shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
    />
  );
}

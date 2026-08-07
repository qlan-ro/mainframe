/**
 * PanelSection — the collapsible chrome every session-panel section wears: a
 * fixed-height header row (icon, label, optional count) whose whole width is
 * the collapse trigger, with the chevron on the trailing edge.
 *
 * Open-state is a prop, not local state: `store/ui-prefs.ts` owns it so an
 * expansion survives a remount and a session switch. `sectionRef` is the panel
 * state machine's scroll-to registration — a rail click scrolls to this element.
 */
import type { ComponentType, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { cn } from '@v2/lib/utils';
import type { SessionPanelOpenSectionId } from '@/store/ui-prefs';

/** The header rhythm the non-collapsible Summary heading shares. The panel is
 *  dense by CHROME, not by type: rows keep the app's `text-sm`, and a 32px
 *  header over 26px rows buys the density that shrinking the type would have. */
export const SECTION_HEAD = 'flex h-8 items-center gap-2 px-2';

interface PanelSectionProps {
  id: SessionPanelOpenSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Omitted renders no badge — a section with nothing to count shows nothing. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  sectionRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}

export function PanelSection({
  id,
  label,
  icon: Icon,
  count,
  open,
  onToggle,
  sectionRef,
  children,
}: PanelSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} asChild>
      <section
        ref={sectionRef}
        data-testid={`session-panel-section-${id}`}
        className="shrink-0 border-b border-border last:border-b-0"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid={`session-panel-section-toggle-${id}`}
            className={cn(SECTION_HEAD, 'w-full text-left transition-colors hover:bg-foreground/8')}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-medium">{label}</span>
            {count != null && <Badge variant="secondary">{count}</Badge>}
            <span className="flex-1" />
            <ChevronDown
              className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 px-2 pb-2">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * PanelSection — the collapsible chrome a session-panel section wears: the
 * SAME eyebrow header as every other section (label only — no icon, no count)
 * whose whole width is the collapse trigger, with the chevron on the trailing edge.
 *
 * Open-state is a prop, not local state: `store/ui-prefs.ts` owns it so an
 * expansion survives a remount and a session switch.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { SessionPanelOpenSectionId } from '@/store/ui-prefs';
import { EYEBROW } from './PanelEyebrow';

/** The header rhythm every section shares (`PanelEyebrow`). The panel is
 *  dense by CHROME, not by type: rows keep the app's `text-sm`, and a 32px
 *  header over 26px rows buys the density that shrinking the type would have. */
export const SECTION_HEAD = 'flex h-8 items-center gap-2 px-2';

interface PanelSectionProps {
  id: SessionPanelOpenSectionId;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function PanelSection({ id, label, open, onToggle, children }: PanelSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} asChild>
      <section data-testid={`session-panel-section-${id}`} className="shrink-0 border-b border-border last:border-b-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid={`session-panel-section-toggle-${id}`}
            className={cn(SECTION_HEAD, 'w-full text-left transition-colors hover:bg-foreground/8')}
          >
            <span className={cn(EYEBROW, 'min-w-0 truncate')}>{label}</span>
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

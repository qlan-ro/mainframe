/**
 * PanelCard — the glass card each stacked panel wears: a fixed header row
 * (icon, label, optional count, close X) over the panel's own scroll region.
 *
 * Glass, not a solid fill: the stack floats OVER the transcript, and a surface
 * that lets the text move underneath reads as companion chrome rather than a
 * second column. The alpha carries the legibility — the blur is the finish, so
 * the card still reads if a webview declines to composite it.
 *
 * Every card caps its own height and scrolls internally, so a long stack
 * degrades card by card instead of pushing its siblings off the surface.
 */
import type { ComponentType, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SessionPanelId } from '@/store/ui-prefs';

const CARD_CHROME =
  'pointer-events-auto flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background/85 shadow-lg backdrop-blur-xl';

interface PanelCardProps {
  id: SessionPanelId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Omitted renders no badge — a panel with nothing to count shows nothing. */
  count?: number;
  onClose: () => void;
  /** Height cap — the default suits the list panels; the session card runs taller. */
  className?: string;
  children: ReactNode;
}

export function PanelCard({ id, label, icon: Icon, count, onClose, className, children }: PanelCardProps) {
  return (
    <section data-testid={`session-panel-card-${id}`} className={cn(CARD_CHROME, className ?? 'max-h-96')}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
        {count != null && <Badge variant="secondary">{count}</Badge>}
        <span className="flex-1" />
        <button
          type="button"
          data-testid={`session-panel-card-close-${id}`}
          aria-label={`Close ${label}`}
          onClick={onClose}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
        >
          <X className="size-3" aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  );
}

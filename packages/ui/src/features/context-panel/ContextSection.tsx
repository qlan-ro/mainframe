import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { CountBadge } from '@/components/ui/count-badge';

interface ContextSectionProps {
  icon: LucideIcon;
  title: string;
  count?: number;
  /** Replaces the count chip and fills the remaining header width (title shrinks to its text). */
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible context group: chevron + icon + title + count chip (or a trailing slot), then children. */
export function ContextSection({
  icon: Icon,
  title,
  count,
  trailing,
  defaultOpen = false,
  children,
}: ContextSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        type="button"
        data-testid={`sidebar-context-section-${title.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-[12px] py-1.5 text-left"
      >
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={`text-caption font-medium text-muted-foreground ${trailing != null ? 'flex-none' : 'min-w-0 flex-1 truncate'}`}
        >
          {title}
        </span>
        {trailing ?? (count != null && <CountBadge count={count} variant="info" showZero className="shrink-0" />)}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

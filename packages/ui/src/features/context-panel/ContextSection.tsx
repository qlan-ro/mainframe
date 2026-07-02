import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

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
export function ContextSection({ icon: Icon, title, count, trailing, defaultOpen = false, children }: ContextSectionProps) {
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
          size={9}
          aria-hidden
          className={`shrink-0 text-mf-text-3 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <Icon size={11} className="shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={`text-micro font-semibold text-foreground ${trailing != null ? 'flex-none' : 'min-w-0 flex-1 truncate'}`}
        >
          {title}
        </span>
        {trailing ??
          (count != null && (
            <span className="shrink-0 rounded-md bg-mf-chip px-1.5 font-mono text-micro text-mf-text-3">{count}</span>
          ))}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

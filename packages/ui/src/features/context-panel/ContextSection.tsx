import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

interface ContextSectionProps {
  icon: LucideIcon;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible context group: chevron + icon + title + count chip, then children. */
export function ContextSection({ icon: Icon, title, count, defaultOpen = false, children }: ContextSectionProps) {
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
        <Icon size={11} className="shrink-0 text-mf-text-2" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-micro font-semibold text-foreground">{title}</span>
        <span className="shrink-0 rounded-md bg-mf-hover px-1.5 font-mono text-micro text-mf-text-3">{count}</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

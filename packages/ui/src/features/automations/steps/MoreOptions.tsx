/**
 * MoreOptions — disclosure wrapper for the rare knobs each step config folds
 * under (ts153 wf2-stepconfig.jsx `WfMore`).
 *
 * ts153's trigger label was `text-micro font-bold uppercase tracking-wide` —
 * exactly the "eyebrow antipattern" the 2026-07-11 typography audit (§4) bans.
 * Approved drift: `text-caption font-medium text-muted-foreground`, sentence
 * case, no uppercase/tracking.
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MoreOptionsProps {
  children: ReactNode;
  testId: string;
  label?: string;
}

export function MoreOptions({ children, testId, label = 'More options' }: MoreOptionsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-[5px] text-caption font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight size={10} className={cn('transition-transform', open && 'rotate-90')} aria-hidden />
        {label}
      </button>
      {open && (
        <div data-testid={`${testId}-content`} className="mt-2.5 flex flex-col gap-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

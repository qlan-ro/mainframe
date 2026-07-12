/**
 * FieldRow — label-left, content-right row layout shared by every step
 * config's "More options" body (ts153 wf2-stepconfig.jsx `WfRow`). Pure
 * layout, no behavior of its own — exercised indirectly through the config
 * panels that use it.
 *
 * ts153's label style was the eyebrow antipattern (micro/bold/uppercase/
 * tracking); approved drift per the 2026-07-11 typography audit (§4):
 * `text-caption font-medium text-muted-foreground`, sentence case.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FieldRowProps {
  label: string;
  top?: boolean;
  children: ReactNode;
}

export function FieldRow({ label, top, children }: FieldRowProps) {
  return (
    <div className={cn('flex gap-2.5', top ? 'items-start' : 'items-center')}>
      <span
        className={cn('w-[76px] shrink-0 text-right text-caption font-medium text-muted-foreground', top && 'pt-1')}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

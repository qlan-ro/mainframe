/**
 * NoProjectLabel — the muted, italic "No project" indicator with a small
 * dashed glyph, standing in for ProjectChip/ProjectAvatar wherever a chat or
 * draft has no project (todo #346). Shared by the welcome picker's trigger,
 * the sidebar row and group header, the archived-sessions dialog and the
 * command palette, so "no project" resolves to one look everywhere.
 */
import type { ComponentPropsWithoutRef } from 'react';
import { SquareDashedBottom } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoProjectLabelProps extends ComponentPropsWithoutRef<'span'> {
  /** Glyph size in px (default 14). */
  size?: number;
}

export function NoProjectLabel({ size = 14, className, ...props }: NoProjectLabelProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 italic text-muted-foreground', className)} {...props}>
      <SquareDashedBottom size={size} className="shrink-0" aria-hidden />
      <span className="truncate">No project</span>
    </span>
  );
}

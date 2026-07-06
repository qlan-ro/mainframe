/**
 * ProjectChip — the per-project identity chip (dot + name) tinted by the
 * deterministic `projectColor(projectId)` oklch hue. Passthrough primitive:
 * forwards `data-testid`/className/style. Used by the chat header (draft variant),
 * the draft row, the Welcome context line, and the new-session picker rows.
 */
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';

interface ProjectChipProps extends ComponentPropsWithoutRef<'span'> {
  projectId: string;
  name: string;
  /** Overall chip height in px (default 16). */
  size?: number;
}

export function ProjectChip({ projectId, name, size = 16, className, style, ...props }: ProjectChipProps) {
  const color = projectColor(projectId);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-[5px] rounded-full px-[7px] font-medium', className)}
      style={{
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        fontSize: 11,
        ...style,
      }}
      {...props}
    >
      <span className="size-1.5 flex-shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

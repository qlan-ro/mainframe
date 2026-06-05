import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'good' | 'bad' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-mf-success bg-mf-success-tint',
  bad: 'text-destructive bg-mf-destructive-tint',
  neutral: 'text-muted-foreground bg-mf-raised',
};

export function ResolvedPill({
  tone,
  label,
  icon,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone: Tone; label: string; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {label}
    </span>
  );
}

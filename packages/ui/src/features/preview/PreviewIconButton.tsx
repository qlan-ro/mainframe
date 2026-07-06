import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';

interface PreviewIconButtonProps {
  testId: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
  /** Accent-tinted "on" state (e.g. inspect active) — matches the prototype PvToolBtn. */
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Small toolbar icon button used across the preview toolbar (URL bar + capture
 * cluster). A bespoke `<button>` rather than the shadcn `Button` primitive
 * because that primitive hard-codes `[&_svg]:size-4` (16px), which overrides the
 * icon `size` prop. The design's toolbar glyphs are 13px, so we own the box here.
 *
 * Geometry mirrors the prototype `PvToolBtn`: 22×22, 6px radius, transparent →
 * accent hover; the accent-tinted "on" state colors the glyph with the brand.
 */
export function PreviewIconButton({
  testId,
  title,
  onClick,
  children,
  active = false,
  disabled = false,
  className,
}: PreviewIconButtonProps) {
  return (
    <Hint label={title}>
      <button
        data-testid={testId}
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-sm transition-colors',
          active ? 'bg-mf-chip text-primary' : 'text-muted-foreground hover:bg-accent',
          disabled && 'pointer-events-none opacity-40',
          className,
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

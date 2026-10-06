/**
 * NavRailButton — one 38px button on the nav rail: a 20px lucide glyph,
 * `rounded-[10px]`, `bg-sidebar-accent` when selected, optional `primary`
 * dot for "something here wants you". The hint sits to the right because the
 * rail is the window's left edge.
 *
 * `Hint` wraps from the outside, so every rest prop — including the ref and
 * handlers Radix's `TooltipTrigger asChild` injects — reaches the `<button>`.
 */
import type { ComponentProps, ComponentType } from 'react';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';

interface NavRailButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  testId: string;
  /** Accessible name AND the hint — an icon-only control has no other. */
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  selected?: boolean;
  /** A `primary` dot in the glyph's corner; `dotTestId` names it when it carries meaning. */
  dot?: boolean;
  dotTestId?: string;
}

export function NavRailButton({
  testId,
  label,
  icon: Icon,
  selected = false,
  dot = false,
  dotTestId,
  className,
  ...props
}: NavRailButtonProps) {
  return (
    <Hint label={label} side="right">
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-pressed={selected || undefined}
        className={cn(
          'relative flex size-9.5 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors',
          'hover:bg-sidebar-accent hover:text-foreground',
          selected && 'bg-sidebar-accent text-foreground',
          className,
        )}
        {...props}
      >
        <Icon size={20} aria-hidden />
        {dot && (
          <span
            data-testid={dotTestId}
            className="absolute top-2 right-2 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
          />
        )}
      </button>
    </Hint>
  );
}

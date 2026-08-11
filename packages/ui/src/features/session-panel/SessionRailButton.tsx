/**
 * SessionRailButton — the two button shapes the session panel's rail is built
 * from: a round icon button, and the stacked ring-over-percentage meter.
 *
 * Feature-local rather than a `v2/components/ui/` primitive: the v2 tree is
 * stock registry output and is not drifted. Both shapes override the stock
 * `Button` (a pill radius the rail's other controls share; the meter's
 * `h-auto w-8 flex-col` stack), and a stack of overrides belongs in one owned
 * file rather than repeated across four call sites.
 *
 * Two exports rather than one component with everything optional: a single
 * component taking `icon?` and `percent?` would let a caller pass neither.
 *
 * `Hint` wraps these from the OUTSIDE, so every rest prop — including the ref
 * and handlers Radix's `TooltipTrigger asChild` injects — must reach the real
 * `<button>`. `label` is the accessible name; an icon-only control has no other.
 */
import type { ComponentProps, ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { QuotaRing } from '@/features/quota/QuotaRing';
import type { QuotaSeverity } from '@/features/quota/quota-format';
import { cn } from '@/lib/utils';

/** Resting chrome shared by both shapes; engaged is added by the caller's `pressed`. */
const RAIL_INK = 'text-muted-foreground';

/** Engaged = the panel this button opened is currently floating. */
const RAIL_ENGAGED = 'bg-sidebar-selection text-primary';

type ButtonProps = ComponentProps<typeof Button>;

interface RailIconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'variant'> {
  testId: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Omitted for buttons that never toggle — the launch quick action. */
  pressed?: boolean;
  /** A live-work marker in the corner; the tooltip carries what is running. */
  dot?: boolean;
}

export function RailIconButton({ testId, label, icon: Icon, pressed, dot, className, ...props }: RailIconButtonProps) {
  return (
    <Button
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      variant="ghost"
      size="icon-sm"
      className={cn('relative rounded-full', RAIL_INK, pressed && RAIL_ENGAGED, className)}
      {...props}
    >
      {/* No size class: the Button's own `[&_svg]` rule owns glyph size. */}
      <Icon />
      {dot && (
        <span
          data-testid={`${testId}-dot`}
          className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-primary"
        />
      )}
    </Button>
  );
}

interface RailMeterButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'variant'> {
  testId: string;
  label: string;
  percent: number;
  severity: QuotaSeverity;
}

/**
 * The app's radial usage glyph with its percentage stacked below — reused
 * rather than redrawn, since the quota footer already answers "how full is it?"
 * with this donut and a rail is too narrow for a horizontal meter. The number
 * rides below because `QuotaRing` masks its own children away.
 */
export function RailMeterButton({ testId, label, percent, severity, className, ...props }: RailMeterButtonProps) {
  return (
    <Button
      data-testid={testId}
      aria-label={label}
      variant="ghost"
      size="icon-sm"
      className={cn('h-auto w-8 flex-col gap-1 rounded-2xl py-1.5', RAIL_INK, className)}
      {...props}
    >
      {/* Muted: the rail is quiet chrome — only the red band may shout. */}
      <QuotaRing usedPercent={percent} severity={severity} muted />
      {/* Mono: a numeric count is one of the reserved mono cases. */}
      <span className="font-mono text-xs tabular-nums">{percent}%</span>
    </Button>
  );
}

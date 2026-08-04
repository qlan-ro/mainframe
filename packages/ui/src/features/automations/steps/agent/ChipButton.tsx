/**
 * ChipButton — the Agent card's toolbar chip (todo #234 T15), shaped on the
 * composer's `config-toolbar/PermissionSelect` so both surfaces read as the
 * same control.
 *
 * A chip shows only its *value*; the field it configures is carried on
 * `title`/`aria-label`. At 20px there is no room for "Model: Sonnet 5", and
 * the icon already names the field for sighted users.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const CHIP_BASE = [
  'flex h-[20px] shrink-0 items-center gap-[5px] rounded-[11px] border-[0.5px] border-border px-[8px]',
  'text-xs font-medium transition-colors',
  'hover:bg-accent hover:text-accent-foreground',
  'data-[state=open]:border-primary data-[state=open]:bg-sidebar-selection',
  'disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none',
].join(' ');

export interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Descriptive name of the field, e.g. `Model: Claude · Sonnet 5`. */
  label: string;
  testId: string;
  destructive?: boolean;
  chevron?: boolean;
  children: ReactNode;
}

export const ChipButton = forwardRef<HTMLButtonElement, ChipButtonProps>(function ChipButton(
  { icon: Icon, label, testId, destructive, chevron, children, className, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      data-testid={testId}
      title={label}
      aria-label={label}
      className={cn(CHIP_BASE, destructive ? 'text-destructive' : 'text-muted-foreground', className)}
      {...props}
    >
      <Icon size={12} className="shrink-0" aria-hidden />
      {children}
      {chevron && <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
});

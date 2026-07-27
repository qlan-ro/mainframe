/**
 * SegmentedControl — a one-of-N mode switch (`SchedulePicker`'s
 * preset/custom/once). `components/ui/` has no tabs or segmented primitive,
 * and Radix Tabs would tie the choice to panel mounting; this is a plain
 * `aria-pressed` button row, so callers stay free to render whatever the
 * chosen mode implies.
 *
 * Clicking the selected option is a no-op: `onChange` means "the value
 * changed", so callers can seed state from it without guarding re-entry.
 */
import { cn } from '@/lib/utils';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedControlOption<T>>;
  value: T;
  onChange: (next: T) => void;
  testIdPrefix: string;
  label?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testIdPrefix,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex h-[24px] items-center rounded-md border-[0.5px] bg-muted p-[2px]', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-testid={`${testIdPrefix}-${option.value}`}
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            className={cn(
              'h-full rounded-[5px] px-2 text-caption font-medium transition-colors',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

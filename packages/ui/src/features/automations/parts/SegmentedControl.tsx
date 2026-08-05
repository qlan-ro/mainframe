/**
 * SegmentedControl — a one-of-N mode switch (`SchedulePicker`'s
 * preset/custom/once) on the v2 Tabs primitives. Only the List/Trigger pair
 * is used — no TabsContent — so callers stay free to render whatever the
 * chosen mode implies.
 *
 * Radix Tabs never re-fires on the selected option, so `onChange` still
 * means "the value changed" and callers can seed state from it without
 * guarding re-entry.
 */
import { Tabs, TabsList, TabsTrigger } from '@v2/components/ui/tabs';
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
    // manual activation: automatic mode also activates on FOCUS, so a plain
    // click would fire onChange twice before the parent re-renders.
    <Tabs
      value={value}
      activationMode="manual"
      onValueChange={(next) => onChange(next as T)}
      className={cn('w-fit', className)}
    >
      <TabsList aria-label={label} className="h-6 p-[2px]">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            data-testid={`${testIdPrefix}-${option.value}`}
            className="px-2 text-xs font-medium"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

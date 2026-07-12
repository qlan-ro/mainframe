/**
 * MiniSelect — compact curated-options select (ts153 `WfMiniSelect`).
 *
 * A native `<select>` styled to match `ui/select.tsx`, not the Radix
 * primitive itself: the prototype used a raw `<select>` here too, and it
 * keeps `WfSchedulePicker` (Phase 3) trivially testable with `fireEvent.change`
 * instead of driving a portal-based popover for a handful of curated strings.
 */
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MiniSelectProps {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  testId: string;
  mono?: boolean;
  width?: number;
}

export function MiniSelect({ value, onChange, options, testId, mono, width }: MiniSelectProps) {
  return (
    <span className="relative inline-flex" style={width ? { width } : undefined}>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-[30px] w-full appearance-none rounded-md border-[0.5px] border-input bg-card py-0 pl-[10px] pr-[24px]',
          'text-caption text-foreground outline-none',
          mono && 'font-mono',
        )}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-[9px] top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  );
}

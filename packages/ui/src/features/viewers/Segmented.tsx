import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Segmented — the one-of-N pill toggle reused across viewers (Preview/Source,
 * Fit/100%, Preview/Code).
 *
 * v2 renders an exclusive segmented switch as Tabs List+Trigger with no
 * TabsContent: the panel each segment reveals is the viewer body, which the
 * caller owns. `activationMode="manual"` because `onChange` writes — automatic
 * activation also fires on focus, which would double-write.
 *
 * Compacted to the 24px chrome row via the same group modifier the primitive
 * uses for its own height, so tailwind-merge replaces it rather than stacking.
 */
export interface SegmentedOption {
  id: string;
  label?: string;
  icon?: ReactNode;
  testId?: string;
}

interface SegmentedProps {
  value: string;
  onChange: (id: string) => void;
  options: SegmentedOption[];
}

export function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <Tabs value={value} onValueChange={onChange} activationMode="manual" className="shrink-0">
      <TabsList className="gap-px rounded-md p-0.5 group-data-horizontal/tabs:h-6">
        {options.map((o) => (
          <TabsTrigger
            key={o.id}
            value={o.id}
            data-testid={o.testId}
            className="gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3"
          >
            {o.icon}
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

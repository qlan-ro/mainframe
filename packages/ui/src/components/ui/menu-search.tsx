import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MenuSearch({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="mx-0.5 mt-0.5 mb-1 flex h-7.5 shrink-0 items-center gap-1.5 rounded-[7px] bg-chrome-chip px-2 text-muted-foreground">
      <SearchIcon className="size-3 shrink-0" aria-hidden />
      <CommandPrimitive.Input
        className={cn(
          'min-w-0 flex-1 rounded-sm bg-transparent px-0.5 text-body text-foreground outline-hidden focus-visible:focus-line-inset placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    </div>
  );
}

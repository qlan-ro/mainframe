/** The quiet 28px button every composer toolbar control shares. */
import { cn } from '@/lib/utils';

export function toolbarButton(open: boolean, className?: string): string {
  return cn(
    'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm whitespace-nowrap text-foreground/90',
    'transition-colors hover:bg-accent focus-visible:focus-line aria-disabled:cursor-default aria-disabled:hover:bg-transparent',
    // State, not data-[state=open]: the tooltip's asChild trigger overwrites data-state.
    open && 'bg-accent',
    className,
  );
}

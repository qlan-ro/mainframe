/** The quiet 28px button every composer toolbar control shares. */
import { cn } from '@/lib/utils';

export function toolbarButton(open: boolean, className?: string): string {
  return cn(
    'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-body whitespace-nowrap text-ink-secondary',
    'transition-colors hover:bg-sidebar-accent focus-visible:focus-line aria-disabled:cursor-default aria-disabled:hover:bg-transparent',
    // State, not data-[state=open]: the tooltip's asChild trigger overwrites data-state.
    open && 'bg-chrome-press hover:bg-chrome-press',
    className,
  );
}

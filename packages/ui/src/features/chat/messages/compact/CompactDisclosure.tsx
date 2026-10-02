import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useCompactDisclosure } from './use-compact-disclosure';
import { useCompactScrollAnchor } from './use-compact-scroll-anchor';

export interface CompactDisclosureProps {
  memberKeys: readonly string[];
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}
export function CompactDisclosure({ memberKeys, label, icon, trailing, children }: CompactDisclosureProps) {
  const { open, setOpen } = useCompactDisclosure(memberKeys);
  const { rowRef, beforeToggle } = useCompactScrollAnchor(open);
  const identity = encodeURIComponent(memberKeys[0] ?? '');
  return (
    <Collapsible
      ref={rowRef}
      open={open}
      onOpenChange={(next) => {
        beforeToggle();
        setOpen(next);
      }}
      data-testid={`chat-compact-row-${identity}`}
      className="min-w-0 py-0.5"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger
            data-testid={`chat-compact-toggle-${identity}`}
            aria-label={label}
            className="flex w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing}
            <ChevronRightIcon aria-hidden className={`size-3 shrink-0 ${open ? 'rotate-90' : ''}`} />
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm break-all">{label}</TooltipContent>
      </Tooltip>
      <CollapsibleContent
        data-testid={`chat-compact-details-${identity}`}
        className="min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ maxHeight: 'min(24rem, 50cqh)' }}
      >
        <div className="min-w-0 space-y-2 py-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

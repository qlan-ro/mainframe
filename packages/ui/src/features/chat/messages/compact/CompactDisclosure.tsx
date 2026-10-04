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
  expandable?: boolean;
  maxDetailHeight?: string;
}
function DisclosureTrigger({
  identity,
  label,
  icon,
  trailing,
  open,
}: {
  identity: string;
  label: string;
  icon: ReactNode;
  trailing: ReactNode;
  open: boolean;
}) {
  return (
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
  );
}
export function CompactDisclosure({
  memberKeys,
  label,
  icon,
  trailing,
  children,
  expandable = true,
  maxDetailHeight = 'min(24rem, 50cqh)',
}: CompactDisclosureProps) {
  const { open, setOpen } = useCompactDisclosure(memberKeys);
  const { rowRef, beforeToggle } = useCompactScrollAnchor(open);
  const identity = encodeURIComponent(memberKeys[0] ?? '');
  if (!expandable)
    return (
      <div ref={rowRef} data-testid={`chat-compact-row-${identity}`} className="min-w-0 py-0.5">
        <div title={label} className="flex min-w-0 items-center gap-2 py-1 text-xs text-muted-foreground">
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {trailing}
        </div>
      </div>
    );
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
      <DisclosureTrigger identity={identity} label={label} icon={icon} trailing={trailing} open={open} />
      <CollapsibleContent
        data-testid={`chat-compact-details-${identity}`}
        className="min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ maxHeight: maxDetailHeight }}
      >
        <div className="min-w-0 space-y-2 py-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

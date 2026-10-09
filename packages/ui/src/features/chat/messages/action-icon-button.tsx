/**
 * ActionIconButton — the ghost icon button with a tooltip that every message
 * action bar uses (assistant Copy/More, user "Fork from here").
 *
 * A disabled button gets no pointer events, so its tooltip would never open:
 * the trigger is then a wrapping span (the same idiom `SessionContextMenu`
 * uses for its disabled Fork item), and the tooltip carries the reason.
 */
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ActionIconButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  tooltip: string;
};

export const ActionIconButton = ({ tooltip, children, className, ...rest }: ActionIconButtonProps) => {
  const button = (
    <Button variant="ghost" size="icon-xs" className={cn('text-muted-foreground', className)} {...rest}>
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{rest.disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
};

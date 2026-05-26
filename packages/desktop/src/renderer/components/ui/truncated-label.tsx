import * as React from 'react';
import { cn } from '../../lib/utils';

type TruncatedLabelOwnProps = {
  text: string;
  title?: string;
  as?: 'span' | 'div' | 'p';
  className?: string;
  'data-testid'?: string;
};

export type TruncatedLabelProps = TruncatedLabelOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof TruncatedLabelOwnProps>;

export const TruncatedLabel = React.forwardRef<HTMLElement, TruncatedLabelProps>(function TruncatedLabel(
  { text, title, as = 'span', className, ...rest },
  ref,
) {
  const Comp = as as React.ElementType;
  return (
    <Comp ref={ref} className={cn('truncate min-w-0', className)} {...(title !== undefined ? { title } : {})} {...rest}>
      {text}
    </Comp>
  );
});

'use client';

/**
 * The composer's card element, for what has to stay inside its edges: a
 * tooltip opened from the toolbar is clamped to the card (C11). The bottom
 * strip, as wide as the card, stands in for it where there is no card.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const ComposerCardContext = createContext<HTMLElement | null>(null);

export const ComposerCardProvider = ComposerCardContext.Provider;

interface ComposerHintProps {
  label: ReactNode;
  children: ReactElement;
}

/** `Hint`, clamped to the composer card's left and right edges. */
export function ComposerHint({ label, children }: ComposerHintProps) {
  const card = useContext(ComposerCardContext);
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {/* The boundary clamps every side, so the card's own top edge would flip the
          tooltip under its trigger. 200px of slack keeps it above. */}
      <TooltipContent side="top" sideOffset={4} collisionBoundary={card} collisionPadding={{ top: -200 }}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * ProviderDot — the 8px provider mark for the places a logo is too loud: the
 * session tab pill's lead slot, the composer's model chip and the sidebar's
 * usage rows. Brand hue from `provider-avatar.ts`; providers without one read
 * as the muted ink rather than nothing.
 */
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { providerAvatarId, providerDotColor } from './provider-avatar';

interface ProviderDotProps extends HTMLAttributes<HTMLSpanElement> {
  adapterId: string;
  /** Surfaces name their own dot — `<surface>-provider-dot`. */
  testId?: string;
}

export function ProviderDot({ adapterId, testId, className, style, ...props }: ProviderDotProps) {
  const color = providerDotColor(adapterId);
  return (
    <span
      {...props}
      data-testid={testId}
      data-provider-id={providerAvatarId(adapterId)}
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', color == null && 'bg-muted-foreground', className)}
      style={color == null ? style : { backgroundColor: color, ...style }}
    />
  );
}

/**
 * The `/`-trigger hooks that make a command row read as a command rather than a
 * skill: its own test id and a wrench glyph, so the handful of daemon commands
 * are distinguishable from the skills they sit above.
 */
import { Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TriggerItem } from '@/components/trigger-engine/types';

export function commandItemTestId(item: TriggerItem): string | undefined {
  return item.type === 'command' ? `composer-command-item-${item.id}` : undefined;
}

export function commandItemGlyph(item: TriggerItem): ReactNode {
  // Sized by class, not by prop: the CommandItem recipe forces `size-4` on any
  // svg that carries no size class of its own.
  return item.type === 'command' ? <Wrench className="size-3 shrink-0 text-muted-foreground" /> : null;
}

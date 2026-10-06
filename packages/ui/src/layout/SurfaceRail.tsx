import type { SurfaceId } from '@/store/layout';
import { isSurfaceFloor, useLayoutStore } from '@/store/layout';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { Code } from 'lucide-react';
import { ChatGlyph } from './surface-icons';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', Icon: ChatGlyph, activeColor: 'text-primary' },
  { id: 'workspace', label: 'Workspace', Icon: Code, activeColor: 'text-primary' },
];

/**
 * The surface toggle pill in the title bar: a 32px `popover` pill holding two
 * 28px items (Chat · Workspace). Both may be lit; the last lit one is the
 * floor and cannot be toggled off.
 */
export function SurfaceRail() {
  const layout = useLayoutStore((s) => s.layout);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  const lit = SURFACES.filter(({ id }) => layout.top.includes(id) || layout.bottom === id).map(({ id }) => id);

  return (
    <ToggleGroup
      type="multiple"
      data-testid="surface-rail"
      value={lit}
      onValueChange={(next) => {
        // Radix hands back the whole value array; the toggled surface is the
        // symmetric difference against the store-derived current state.
        const changed = SURFACES.find(({ id }) => lit.includes(id) !== next.includes(id));
        if (changed) toggleSurface(changed.id);
      }}
      className="h-8 shrink-0 gap-0.5 rounded-lg border bg-popover p-0.5"
    >
      {SURFACES.map(({ id, label, Icon, activeColor }) => {
        const on = lit.includes(id);
        // Dynamic floor: the single lit surface (whichever it is) can't be toggled off.
        const isFloor = isSurfaceFloor(layout, id);

        return (
          <Hint key={id} label={label}>
            <ToggleGroupItem
              value={id}
              data-testid={`surface-rail-${id}`}
              data-tut={id === 'workspace' ? 'workspace' : undefined}
              disabled={isFloor}
              className={cn(
                'size-7 min-w-0 flex-none rounded-md p-0 first:rounded-md last:rounded-md',
                // Pressed chrome keys off store state, NOT data-[state=on]: the Hint's
                // TooltipTrigger asChild overwrites the item's data-state with the
                // tooltip's open-state ("closed"), so the Radix selector never matches.
                on && 'bg-accent shadow-sm hover:bg-accent',
                isFloor && 'disabled:opacity-60',
              )}
            >
              <Icon size={16} className={on ? activeColor : 'text-muted-foreground'} />
            </ToggleGroupItem>
          </Hint>
        );
      })}
    </ToggleGroup>
  );
}

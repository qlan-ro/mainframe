import type { SurfaceId } from '@/store/layout';
import { isSurfaceFloor, useLayoutStore } from '@/store/layout';
import { ToggleGroup, ToggleGroupItem } from '@v2/components/ui/toggle-group';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@/lib/utils';
import { ChatGlyph, EditorGlyph, PreviewGlyph } from './surface-icons';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', Icon: ChatGlyph, activeColor: 'text-primary' },
  { id: 'files', label: 'Editor', Icon: EditorGlyph, activeColor: 'text-mf-surface-files' },
  { id: 'run', label: 'Preview', Icon: PreviewGlyph, activeColor: 'text-mf-surface-run' },
];

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
      className="shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
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
              data-tut={id === 'run' ? 'run' : undefined}
              disabled={isFloor}
              className={cn(
                'h-6 w-7 min-w-0 flex-none rounded-md p-0 first:rounded-md last:rounded-md',
                'data-[state=on]:bg-background data-[state=on]:shadow-sm',
                isFloor && 'disabled:opacity-60',
              )}
            >
              <Icon size={12} className={on ? activeColor : 'text-muted-foreground'} />
            </ToggleGroupItem>
          </Hint>
        );
      })}
    </ToggleGroup>
  );
}

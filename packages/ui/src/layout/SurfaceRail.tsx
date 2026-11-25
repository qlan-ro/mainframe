import { Code } from 'lucide-react';
import { ChatIcon } from '@/components/ui/glyphs';
import { chordHint } from '@/features/shortcuts/chord-hint';
import type { ShortcutId } from '@/features/shortcuts/registry';
import type { SurfaceId } from '@/store/layout';
import { isSurfaceFloor, isSurfaceLit, useLayoutStore } from '@/store/layout';
import { TitleBarButton } from './TitleBarButton';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  shortcut: ShortcutId;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', shortcut: 'workspace.toggle-chat', Icon: ChatIcon },
  { id: 'workspace', label: 'Workspace', shortcut: 'workspace.toggle-workspace', Icon: Code },
];

/**
 * The surface toggles at the title bar's far right: Chat and Workspace, two
 * independent buttons rather than a segmented control (W3). Both may be lit;
 * the last lit one is the floor and cannot be toggled off.
 */
export function SurfaceRail() {
  const layout = useLayoutStore((s) => s.layout);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div role="group" aria-label="View" data-testid="surface-rail" className="flex shrink-0 gap-0.5">
      {SURFACES.map(({ id, label, shortcut, Icon }) => {
        const chord = chordHint(shortcut);
        // Dynamic floor: the single lit surface (whichever it is) can't be toggled
        // off. `aria-disabled`, not `disabled`, so the tooltip can say why.
        const floor = isSurfaceFloor(layout, id);
        const hint = chord == null ? label : `${label}\u00a0\u00a0${chord}`;
        return (
          <TitleBarButton
            key={id}
            testId={`surface-rail-${id}`}
            data-tut={id === 'workspace' ? 'workspace' : undefined}
            label={label}
            hint={floor ? `${label} is the only surface left` : hint}
            on={isSurfaceLit(layout, id)}
            aria-disabled={floor || undefined}
            onClick={() => !floor && toggleSurface(id)}
          >
            <Icon size={16} />
          </TitleBarButton>
        );
      })}
    </div>
  );
}

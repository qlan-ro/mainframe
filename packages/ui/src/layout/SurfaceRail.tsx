import { Code } from 'lucide-react';
import { chordHint } from '@/features/shortcuts/chord-hint';
import type { ShortcutId } from '@/features/shortcuts/registry';
import type { SurfaceId } from '@/store/layout';
import { isSurfaceFloor, isSurfaceLit, useLayoutStore } from '@/store/layout';
import { ChatGlyph } from './surface-icons';
import { TitleBarButton } from './TitleBarButton';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  shortcut: ShortcutId;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', shortcut: 'workspace.toggle-chat', Icon: ChatGlyph },
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
        return (
          <TitleBarButton
            key={id}
            testId={`surface-rail-${id}`}
            data-tut={id === 'workspace' ? 'workspace' : undefined}
            label={label}
            hint={chord == null ? label : `${label} ${chord}`}
            on={isSurfaceLit(layout, id)}
            // Dynamic floor: the single lit surface (whichever it is) can't be
            // toggled off. It still reads as lit, so it does not dim.
            disabled={isSurfaceFloor(layout, id)}
            className="disabled:opacity-100"
            onClick={() => toggleSurface(id)}
          >
            <Icon size={16} />
          </TitleBarButton>
        );
      })}
    </div>
  );
}

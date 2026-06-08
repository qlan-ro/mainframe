import type { SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';
import { ChatGlyph, EditorGlyph, PreviewGlyph } from './surface-icons';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', Icon: ChatGlyph, activeColor: 'text-primary' },
  { id: 'files', label: 'Editor', Icon: EditorGlyph, activeColor: 'text-[#7a4d9e]' },
  { id: 'run', label: 'Preview', Icon: PreviewGlyph, activeColor: 'text-[#1f9d4d]' },
];

export function SurfaceRail() {
  const layout = useLayoutStore((s) => s.layout);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div data-testid="surface-rail" className="flex flex-shrink-0 gap-0.5 rounded-lg bg-mf-chip p-0.5">
      {SURFACES.map(({ id, label, Icon, activeColor }) => {
        const on = layout.top.includes(id) || layout.bottom === id;
        // Chat is the permanent floor — its button is always lit and never toggleable.
        const isFloor = id === 'chat';

        return (
          <button
            key={id}
            data-testid={`surface-rail-${id}`}
            type="button"
            title={label}
            disabled={isFloor}
            onClick={() => toggleSurface(id)}
            className={[
              'inline-flex h-[21px] w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] border-none p-0',
              'transition-[background,box-shadow] duration-[120ms] ease',
              on
                ? 'bg-mf-tab-active shadow-[0_0.5px_0_var(--border),0_1px_2px_rgba(0,0,0,0.06)]'
                : 'cursor-pointer bg-transparent hover:bg-accent',
              isFloor ? 'cursor-default opacity-60' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Icon size={12} className={on ? activeColor : 'text-mf-text-4'} />
          </button>
        );
      })}
    </div>
  );
}

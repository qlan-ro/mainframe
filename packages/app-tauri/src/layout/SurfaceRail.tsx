import { MessageSquare, FileText, Play } from 'lucide-react';
import type { SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';

interface SurfaceDef {
  id: SurfaceId;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
}

const SURFACES: SurfaceDef[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare, activeColor: 'text-primary' },
  { id: 'files', label: 'Editor', Icon: FileText, activeColor: 'text-[#7a4d9e]' },
  { id: 'run', label: 'Preview', Icon: Play, activeColor: 'text-[#1f9d4d]' },
];

export function SurfaceRail() {
  const surfaces = useLayoutStore((s) => s.surfaces);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const activeCount = Object.values(surfaces).filter(Boolean).length;

  return (
    <div data-testid="surface-rail" className="flex flex-shrink-0 gap-0.5 rounded-lg bg-mf-chip p-0.5">
      {SURFACES.map(({ id, label, Icon, activeColor }) => {
        const on = surfaces[id];
        const isFloor = on && activeCount === 1;

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

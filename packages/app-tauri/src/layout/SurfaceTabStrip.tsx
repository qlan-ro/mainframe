import { FileText, GripHorizontal, LayoutPanelLeft, LayoutPanelTop, Play, Plus, X } from 'lucide-react';
import type { SurfaceId } from '@/store/layout';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

interface Props {
  surface: Exclude<SurfaceId, 'chat'>;
}

const SURFACE_META = {
  files: { Icon: FileText, colorClass: 'text-mf-surface-files', label: 'Files' },
  run: { Icon: Play, colorClass: 'text-mf-surface-run', label: 'Run' },
} as const;

export function SurfaceTabStrip({ surface }: Props) {
  const meta = SURFACE_META[surface];
  const { Icon } = meta;
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div
      data-testid={`${surface}-tab-strip`}
      className="flex h-[34px] flex-shrink-0 items-center bg-mf-tab-bar [border-bottom:0.5px_solid_var(--border)]"
    >
      {/* Drag grip — visual only */}
      <div className="grid h-full w-5 flex-shrink-0 cursor-grab place-items-center pl-1">
        <GripHorizontal size={13} className="text-mf-text-4" />
      </div>

      {/* Surface icon */}
      <div className="flex-shrink-0 px-1">
        <Icon size={11} className={meta.colorClass} />
      </div>

      {/* Tab row — empty until tab model is built */}
      <div className="flex h-full min-w-0 flex-auto items-center gap-0.5 overflow-x-auto pr-0.5 [scrollbar-width:none]" />

      {/* + add button (stub) */}
      <button
        data-testid={`${surface}-tab-strip-add`}
        type="button"
        title={surface === 'files' ? 'Open file / View changes' : 'New terminal / Open preview'}
        className={`${ACTION_BTN} ml-0.5`}
      >
        <Plus size={11} className="text-mf-text-3" />
      </button>

      <div className="flex-1" />

      {/* Right action cluster */}
      <div className="flex flex-shrink-0 items-center gap-px px-1.5">
        {splitAvailable && (
          <>
            <button
              data-testid={`${surface}-tab-strip-split-right`}
              type="button"
              title="Split right"
              onClick={() => splitSurface('v')}
              className={ACTION_BTN}
            >
              <LayoutPanelLeft size={13} className="text-mf-text-3" />
            </button>
            <button
              data-testid={`${surface}-tab-strip-split-down`}
              type="button"
              title="Split down"
              onClick={() => splitSurface('h')}
              className={ACTION_BTN}
            >
              <LayoutPanelTop size={13} className="text-mf-text-3" />
            </button>
          </>
        )}
        <button
          data-testid={`${surface}-tab-strip-close`}
          type="button"
          title={`Close ${meta.label}`}
          onClick={() => toggleSurface(surface)}
          className={ACTION_BTN}
        >
          <X size={12} className="text-mf-text-3" />
        </button>
      </div>
    </div>
  );
}

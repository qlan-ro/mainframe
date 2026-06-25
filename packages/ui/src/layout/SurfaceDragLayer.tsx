/**
 * layout/SurfaceDragLayer.tsx — renders the drag ghost + drop-zone highlight
 * during a surface/tab drag and commits on pointer-up. Mounted once by
 * SurfaceHost. Drop targets opt in by tagging an element with
 * `data-drop-surface="chat|files|run"`.
 */
import { useEffect } from 'react';
import type { SurfaceId } from '@/store/layout';
import { computeDropEdge, useSurfaceDragStore, type DropZone } from './use-surface-drag';

function resolveDropZone(x: number, y: number): DropZone | null {
  const el = document.elementFromPoint(x, y);
  const target = el?.closest<HTMLElement>('[data-drop-surface]');
  if (!target) return null;
  const surface = target.dataset.dropSurface as SurfaceId | undefined;
  if (!surface) return null;
  const rect = target.getBoundingClientRect();
  const edge = computeDropEdge(rect, x, y);
  return { surface, edge };
}

export function SurfaceDragLayer() {
  const kind = useSurfaceDragStore((s) => s.kind);
  const pointer = useSurfaceDragStore((s) => s.pointer);
  const dropZone = useSurfaceDragStore((s) => s.dropZone);
  const setPointer = useSurfaceDragStore((s) => s.setPointer);
  const commit = useSurfaceDragStore((s) => s.commit);
  const cancel = useSurfaceDragStore((s) => s.cancel);

  useEffect(() => {
    if (!kind) return;
    function onMove(e: PointerEvent) {
      setPointer(e.clientX, e.clientY, resolveDropZone(e.clientX, e.clientY));
    }
    function onUp() {
      commit();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [kind, setPointer, commit, cancel]);

  if (!kind) return null;

  return (
    <div data-testid="surface-drag-layer" className="pointer-events-none fixed inset-0 z-[100]">
      {/* Ghost chip following the pointer. */}
      <div
        className="absolute rounded-md bg-mf-glass px-2 py-1 text-caption text-foreground shadow-lg backdrop-blur-[40px]"
        style={{ left: pointer.x + 12, top: pointer.y + 12 }}
      >
        {kind === 'surface' ? 'Move surface' : 'Move tab'}
      </div>

      {/* Drop-zone highlight. */}
      {dropZone && <DropHighlight surface={dropZone.surface} edge={dropZone.edge} />}
    </div>
  );
}

function DropHighlight({ surface, edge }: DropZone) {
  const target = document.querySelector<HTMLElement>(`[data-drop-surface="${surface}"]`);
  if (!target) return null;
  const r = target.getBoundingClientRect();

  // Edge → a half/strip band; center → full overlay.
  const style: React.CSSProperties = {
    position: 'absolute',
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  };
  if (edge === 'left') Object.assign(style, { width: r.width / 2 });
  else if (edge === 'right') Object.assign(style, { left: r.left + r.width / 2, width: r.width / 2 });
  else if (edge === 'top') Object.assign(style, { height: r.height / 2 });
  else if (edge === 'bottom') Object.assign(style, { top: r.top + r.height / 2, height: r.height / 2 });

  return (
    <div
      data-testid={`drop-zone-${edge}`}
      style={style}
      className="rounded-md border-2 border-primary bg-primary opacity-15"
    />
  );
}

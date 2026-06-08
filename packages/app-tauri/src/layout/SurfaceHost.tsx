import { useCallback, useEffect } from 'react';
import { ChatSurface } from '@/features/sessions/new-thread/ChatSurface';
import type { SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';
import { onSurfaceIntent } from '@/store/surface-intents';
import { FilesSurface } from './surfaces/FilesSurface';
import { RunSurface } from './surfaces/RunSurface';

const SHORTCUT_MAP: Record<string, SurfaceId> = {
  '1': 'chat',
  '2': 'files',
  '3': 'run',
};

interface Props {
  port: number;
}

export function SurfaceHost({ port }: Props) {
  const surfaces = useLayoutStore((s) => s.surfaces);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  // Stable subscription — reads live store state inside the callback, no deps.
  useEffect(() => {
    return onSurfaceIntent((intent) => {
      if (intent.type !== 'activate-surface') return;
      const { surfaces: current, toggleSurface: toggle } = useLayoutStore.getState();
      if (!current[intent.surface]) toggle(intent.surface);
    });
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl + 1/2/3 toggle Chat/Files/Run.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const surface = SHORTCUT_MAP[e.key];
      if (!surface) return;
      e.preventDefault();
      toggleSurface(surface);
    },
    [toggleSurface],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div data-testid="chat-thread-area" className="flex flex-1 overflow-hidden">
      {surfaces.chat && <ChatSurface port={port} />}
      {surfaces.files && <FilesSurface />}
      {surfaces.run && <RunSurface />}
    </div>
  );
}

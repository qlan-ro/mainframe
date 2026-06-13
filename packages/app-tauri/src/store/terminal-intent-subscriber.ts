/**
 * store/terminal-intent-subscriber.ts
 *
 * The sanctioned cross-store bridge for the `new-terminal` surface intent.
 * Mounted once in SurfaceHost alongside subscribeToFileIntents. Reads the
 * active bases + the cached homedir, resolves the cwd, creates the PTY+xterm
 * via the feature (which knows nothing about layout), then adds the RunTab.
 *
 * Features never import layout/ — this module is the boundary.
 */
import { createTerminalSession } from '@/features/terminal/create-terminal';
import { disposeCachedTerminal } from '@/features/terminal/terminal-cache';
import { resolveCwd } from '@/features/terminal/terminal-cwd';
import { getHomedir } from '@/lib/tauri/bridge';
import { onSurfaceIntent } from './surface-intents';
import { useActiveBasesStore } from './active-bases-store';
import { useLayoutStore } from './layout';

// Cache the homedir once — it never changes during a session.
let homedirCache: string | null = null;

async function cachedHomedir(): Promise<string> {
  if (homedirCache === null) homedirCache = await getHomedir();
  return homedirCache;
}

export function subscribeToTerminalIntents(): () => void {
  return onSurfaceIntent((intent) => {
    if (intent.type !== 'new-terminal') return;
    void spawnTerminal(intent.paneId);
  });
}

async function spawnTerminal(paneId: string | undefined): Promise<void> {
  try {
    const { worktreePath, projectPath } = useActiveBasesStore.getState().bases;
    const homedir = await cachedHomedir();
    const cwd = resolveCwd({ worktreePath, projectPath, homedir });

    const { id, title } = await createTerminalSession({ cwd, cols: 80, rows: 24 });

    // Ensure the Run surface is visible before adding the tab.
    const layoutStore = useLayoutStore.getState();
    const { layout } = layoutStore;
    const runActive = layout.top.includes('run') || layout.bottom === 'run';
    if (!runActive) layoutStore.toggleSurface('run');

    // addRunTab returns false when an explicit paneId was given but that pane
    // was closed during the async create above (M6). The terminal is already
    // live — dispose it (kills the PTY via the disposer) so it doesn't orphan.
    const added = useLayoutStore.getState().addRunTab({ id, kind: 'terminal', title }, paneId);
    if (!added) {
      disposeCachedTerminal(id);
    }
  } catch (err) {
    console.warn('[terminal-intent] failed to spawn terminal', err);
  }
}

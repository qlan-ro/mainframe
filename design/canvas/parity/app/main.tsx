/**
 * The real app (packages/ui/src/app/App.tsx) over an in-page backend. `backend`
 * is imported first so `fetch` and `WebSocket` are replaced before any app module
 * runs: nothing here opens a connection.
 */
import './backend';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/app.css';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting } from '@/lib/host';
import { applyStoredTheme } from '@/store/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createHttpGateway } from '@/features/automations/data/http-gateway';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { App } from '@/app/App';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { useDraftContent } from '@/features/chat/composer/draft-content/draft-content-store';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useLayoutStore } from '@/store/layout';
import { useCheatSheetStore } from '@/features/shortcuts/cheat-sheet-store';
import { useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { mfToast } from '@/lib/toast';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { FAKE_PORT } from './fixtures';

// The usage capsule turns through the accounts every 4 s; a comparison needs it still.
const every = window.setInterval.bind(window);
window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
  ms === 4_000 ? 0 : every(fn, ms, ...args)) as typeof window.setInterval;

const host = new FakeHostBridge({
  app: { platform: 'darwin', getHomedir: '/Users/dev' },
  daemon: { port: FAKE_PORT, status: 'ready' },
});
setHostForTesting(host);
// For the states a user reaches through another surface (a preview capture, a quoted selection).
Object.assign(window, { __STORES__: { segments: useComposerSegments, draft: useDraftContent, held: useHeldQueue, bases: useActiveBasesStore, layout: useLayoutStore, sheet: useCheatSheetStore, files: useWorkspaceFilesPanel, toast: mfToast } });
applyStoredTheme();
useAutomationsStore.getState().setGateway(createHttpGateway());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HostProvider host={host}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </HostProvider>
  </StrictMode>,
);

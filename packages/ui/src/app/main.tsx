import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { applyStoredTheme, applyStoredScale } from '../store/theme';
import { TooltipProvider, TOOLTIP_DELAY_MS } from '../components/ui/tooltip';
import { getHost, HostProvider } from '../lib/host';
import { createHttpGateway } from '../features/automations/data/http-gateway';
import { useAutomationsStore } from '../features/automations/data/use-automations-store';
import { App } from './App';

applyStoredTheme(); // sync FOUC guard: dark class + data-scheme before first paint
applyStoredScale(); // fire-and-forget: native webview page zoom (async, Tauri-only)

// The store defaults to the in-memory fixture gateway (Phase 0-5 dev backend,
// and what every component/hook test renders against unmodified) — swap in
// the real one here, at the actual app bootstrap, not inside AutomationsHost/
// AppShell: both are rendered directly by unit tests (e.g. layout/chrome.test.tsx
// renders <AppShell>) that never import this file and have no daemon to call.
useAutomationsStore.getState().setGateway(createHttpGateway());

// Install the host-level window-drag listener once at startup.
// TauriAdapter.init() wires the mousedown → startDragging listener.
// ElectronAdapter has no init (CSS handles drag via [data-drag-region]).
const host = getHost();
host.init?.();

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <HostProvider host={host}>
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        <App />
      </TooltipProvider>
    </HostProvider>
  </StrictMode>,
);

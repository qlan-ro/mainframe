import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { applyStoredTheme } from '../store/theme';
import { TooltipProvider } from '../components/ui/tooltip';
import { getHost, HostProvider, isTauriRuntime } from '../lib/host';
import { TauriAdapter } from '../lib/host/tauri-adapter';
import { App } from './App';

applyStoredTheme(); // sync FOUC guard: dark class + data-scheme before first paint

// Install the host-level window-drag listener once at startup (Tauri only).
const host = getHost();
if (isTauriRuntime() && host instanceof TauriAdapter) host.init();

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <HostProvider host={host}>
      <TooltipProvider delayDuration={0}>
        <App />
      </TooltipProvider>
    </HostProvider>
  </StrictMode>,
);

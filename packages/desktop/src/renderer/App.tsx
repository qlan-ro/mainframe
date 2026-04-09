import React, { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { CenterPanel } from './components/center/CenterPanel';
import { SearchPalette } from './components/SearchPalette';
import { SettingsModal } from './components/SettingsModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { Toaster } from './components/Toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { useAppInit } from './hooks/useAppInit';
import { usePluginShortcuts } from './hooks/usePluginShortcuts';
import { useSettingsStore } from './store';
import { getActiveProjectId } from './hooks/useActiveProjectId.js';
import { daemonClient } from './lib/client';
import { getDefaultModelForAdapter } from './lib/adapters';
import { PluginGlobalComponents } from './components/plugins/PluginGlobalComponents';

export default function App(): React.ReactElement {
  useAppInit();
  usePluginShortcuts();

  // Global ⌘N / Ctrl+N — new chat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        const projectId = getActiveProjectId();
        if (projectId) {
          daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Global ⌘, / Ctrl+, — open settings
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        useSettingsStore.getState().open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={200} skipDelayDuration={100} disableHoverableContent>
        <Layout centerPanel={<CenterPanel />} />
        <SearchPalette />
        <SettingsModal />
        <TutorialOverlay />
        <ConnectionOverlay />
        <Toaster />
        <PluginGlobalComponents />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

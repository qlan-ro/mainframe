import React, { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { LeftPanel } from './components/panels/LeftPanel';
import { RightPanel } from './components/panels/RightPanel';
import { CenterPanel } from './components/center/CenterPanel';
import { SearchPalette } from './components/SearchPalette';
import { SettingsModal } from './components/SettingsModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { useAppInit } from './hooks/useAppInit';
import { useProjectsStore, useSettingsStore } from './store';
import { daemonClient } from './lib/client';

export default function App(): React.ReactElement {
  useAppInit();

  // Global ⌘N / Ctrl+N — new chat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        const projectId = useProjectsStore.getState().activeProjectId;
        if (projectId) {
          daemonClient.createChat(projectId, 'claude');
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
      <Layout leftPanel={<LeftPanel />} centerPanel={<CenterPanel />} rightPanel={<RightPanel />} />
      <SearchPalette />
      <SettingsModal />
      <TutorialOverlay />
      <ConnectionOverlay />
    </ErrorBoundary>
  );
}

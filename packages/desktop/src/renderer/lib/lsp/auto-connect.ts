import { useTabsStore } from '../../store/tabs';
import { useProjectsStore } from '../../store/projects';
import { lspClientManager } from './index.js';
import { getLspLanguage } from './language-detection.js';

/**
 * Watch for file views opening and automatically connect the LSP client
 * for the file's language. Runs once at module load time.
 */
function autoConnect(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tryConnect = () => {
    // Debounce — multiple store changes fire within the same tick on page load.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const fileView = useTabsStore.getState().fileView;
      if (!fileView || fileView.type !== 'editor') return;

      const { activeProjectId, projects } = useProjectsStore.getState();
      if (!activeProjectId) return;

      const project = projects.find((p) => p.id === activeProjectId);
      if (!project) return;

      const lspLanguage = getLspLanguage(fileView.filePath);
      if (!lspLanguage) return;

      lspClientManager.ensureClient(project.id, lspLanguage, project.path).catch(() => {});
    }, 500);
  };

  useTabsStore.subscribe((state, prev) => {
    if (state.fileView !== prev.fileView) tryConnect();
  });

  useProjectsStore.subscribe((state, prev) => {
    if (state.projects !== prev.projects || state.activeProjectId !== prev.activeProjectId) {
      tryConnect();
    }
  });

  tryConnect();
}

autoConnect();

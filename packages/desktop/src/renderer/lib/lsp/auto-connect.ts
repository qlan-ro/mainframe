import { useTabsStore } from '../../store/tabs';
import { useProjectsStore } from '../../store/projects';
import { useChatsStore } from '../../store/chats';
import { getActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { lspClientManager } from './index.js';
import { getLspLanguage } from './language-detection.js';

/**
 * Watch for file views opening and automatically connect the LSP client
 * for the file's language. Sends didOpen eagerly so tsserver has time to
 * load the project before the user tries Go To Definition.
 */
function autoConnect(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tryConnect = () => {
    // Debounce — multiple store changes fire within the same tick on page load.
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const fileView = useTabsStore.getState().fileView;
      if (!fileView || fileView.type !== 'editor') return;

      const activeProjectId = getActiveProjectId();
      if (!activeProjectId) return;

      const { projects } = useProjectsStore.getState();
      const project = projects.find((p) => p.id === activeProjectId);
      if (!project) return;

      const lspLanguage = getLspLanguage(fileView.filePath);
      if (!lspLanguage) return;

      try {
        await lspClientManager.ensureClient(project.id, lspLanguage, project.path);
        // Send didOpen eagerly so tsserver starts loading the project immediately.
        lspClientManager.preloadDocument(project.id, lspLanguage, project.path, fileView.filePath);
      } catch {
        // connection failed — ignore
      }
    }, 500);
  };

  useTabsStore.subscribe((state, prev) => {
    if (state.fileView !== prev.fileView) tryConnect();
  });

  useProjectsStore.subscribe((state, prev) => {
    if (state.projects !== prev.projects) tryConnect();
  });

  // Re-derive activeProjectId when the active chat changes.
  useChatsStore.subscribe((state, prev) => {
    if (state.activeChatId !== prev.activeChatId) tryConnect();
  });

  tryConnect();
}

autoConnect();

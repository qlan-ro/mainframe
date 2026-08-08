/**
 * workspace-files-panel — the floating Files panel's open state (transient,
 * like the session panel's overlay: never persisted, light-dismissed).
 *
 * Lives in store/ (not features/) because the intent subscriber opens it for
 * `toggle-workspace-files` and `reveal-file`, and store/ must not import
 * features/.
 */
import { create } from 'zustand';

interface WorkspaceFilesPanelStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useWorkspaceFilesPanel = create<WorkspaceFilesPanelStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

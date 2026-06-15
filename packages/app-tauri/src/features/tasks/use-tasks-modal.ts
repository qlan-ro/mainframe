/**
 * use-tasks-modal — zustand store for the Tasks full-view modal + quick-add dialog.
 *
 * The drawer's expand button, the toolbar affordance, and ⌘⇧T all dispatch
 * through this store. No reach-through into other stores.
 */
import { create } from 'zustand';

interface TasksModalState {
  open: boolean;
  quickOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  openQuick: () => void;
  closeQuick: () => void;
}

export const useTasksModal = create<TasksModalState>((set) => ({
  open: false,
  quickOpen: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  openQuick: () => set({ quickOpen: true }),
  closeQuick: () => set({ quickOpen: false }),
}));

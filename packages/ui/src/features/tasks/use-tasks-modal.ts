/**
 * use-tasks-modal — zustand store for the Tasks full-view modal, the quick-add
 * dialog, and the ONE task edit modal.
 *
 * The edit modal used to be local state in both the board and the panel's
 * Tasks card, each with its own `TaskEditModal` implementation. It is one
 * modal now, mounted once in `TasksModalHost` and opened from anywhere
 * (board, panel card, sidebar list) through `openEdit`. `todoId: null` is the
 * create form. The board's expand button, the rail, and ⌘⇧T all dispatch
 * through this store. No reach-through into other stores.
 */
import { create } from 'zustand';

export interface TaskEditTarget {
  projectId: string;
  /** Null opens the create form for `projectId`. */
  todoId: string | null;
}

interface TasksModalState {
  open: boolean;
  quickOpen: boolean;
  edit: TaskEditTarget | null;
  openModal: () => void;
  closeModal: () => void;
  openQuick: () => void;
  closeQuick: () => void;
  openEdit: (target: TaskEditTarget) => void;
  closeEdit: () => void;
}

export const useTasksModal = create<TasksModalState>((set) => ({
  open: false,
  quickOpen: false,
  edit: null,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  openQuick: () => set({ quickOpen: true }),
  closeQuick: () => set({ quickOpen: false }),
  openEdit: (edit) => set({ edit }),
  closeEdit: () => set({ edit: null }),
}));

/**
 * use-tasks-modal — zustand store for the quick-add dialog and the ONE task
 * edit modal. (The Kanban/List board used to be a third dialog here; it is
 * body content now — `TasksSurface`, rendered while `sidebarView` is
 * 'tasks' — so there is no `open`/`openModal`/`closeModal` any more.)
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
  quickOpen: boolean;
  edit: TaskEditTarget | null;
  openQuick: () => void;
  closeQuick: () => void;
  openEdit: (target: TaskEditTarget) => void;
  closeEdit: () => void;
}

export const useTasksModal = create<TasksModalState>((set) => ({
  quickOpen: false,
  edit: null,
  openQuick: () => set({ quickOpen: true }),
  closeQuick: () => set({ quickOpen: false }),
  openEdit: (edit) => set({ edit }),
  closeEdit: () => set({ edit: null }),
}));

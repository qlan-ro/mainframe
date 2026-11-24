/**
 * The pending requests of a chat's delegated tasks (G5), reported by one
 * `DelegatedGateProbe` per waiting task and read by `useGateQueue`.
 */
import { create } from 'zustand';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import type { ReplyFn } from './gate-types';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';

export interface DelegatedGate {
  parentChatId: string;
  taskId: string;
  /** The task of THIS chat it runs under (itself, unless a task delegated further). */
  topTaskId: string;
  title: string;
  adapterId: string | undefined;
  mode: ExecutionMode | undefined;
  entries: readonly ChatPermissionEntry[];
  reply: ReplyFn;
}

interface DelegatedGatesState {
  byTask: Readonly<Record<string, DelegatedGate>>;
  report: (gate: DelegatedGate) => void;
  clear: (taskId: string) => void;
}

export const useDelegatedGates = create<DelegatedGatesState>((set) => ({
  byTask: {},
  report: (gate) => set((s) => ({ byTask: { ...s.byTask, [gate.taskId]: gate } })),
  clear: (taskId) =>
    set((s) => {
      if (!(taskId in s.byTask)) return s;
      const { [taskId]: _, ...byTask } = s.byTask;
      return { byTask };
    }),
}));

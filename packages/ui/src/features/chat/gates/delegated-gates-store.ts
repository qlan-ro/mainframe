/**
 * The pending requests of a chat's delegated tasks (G5), reported by one
 * `DelegatedGateProbe` per waiting task and read by `useGateQueue`.
 */
import { create } from 'zustand';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import type { ReplyFn } from './gate-types';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';

export interface DelegatedGate {
  /** The chat showing it. Two zones can surface the same task: a parent and its own child. */
  parentChatId: string;
  /** The chat that asks. */
  chatId: string;
  taskId: string;
  /** The task of THIS chat it runs under (itself, unless a task delegated further). */
  topTaskId: string;
  title: string;
  /** The task it runs under, when a task delegated further. */
  parentTitle: string | undefined;
  adapterId: string | undefined;
  mode: ExecutionMode | undefined;
  entries: readonly ChatPermissionEntry[];
  reply: ReplyFn;
}

interface DelegatedGatesState {
  byTask: Readonly<Record<string, DelegatedGate>>;
  report: (gate: DelegatedGate) => void;
  clear: (parentChatId: string, taskId: string) => void;
}

const keyOf = (parentChatId: string, taskId: string): string => `${parentChatId}:${taskId}`;

export const useDelegatedGates = create<DelegatedGatesState>((set) => ({
  byTask: {},
  report: (gate) => set((s) => ({ byTask: { ...s.byTask, [keyOf(gate.parentChatId, gate.taskId)]: gate } })),
  clear: (parentChatId, taskId) =>
    set((s) => {
      const key = keyOf(parentChatId, taskId);
      if (!(key in s.byTask)) return s;
      const { [key]: _, ...byTask } = s.byTask;
      return { byTask };
    }),
}));

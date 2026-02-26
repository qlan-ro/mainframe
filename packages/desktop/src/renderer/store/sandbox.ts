import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { LaunchProcessStatus } from '@mainframe/types';

export interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
}

interface SandboxState {
  captures: Capture[];
  // Scoped by projectId so statuses from different projects never bleed together
  processStatuses: { [projectId: string]: { [name: string]: LaunchProcessStatus } };
  logsOutput: { projectId: string; name: string; data: string; stream: 'stdout' | 'stderr' }[];
  selectedConfigName: string | null;

  addCapture: (capture: Omit<Capture, 'id'>) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setProcessStatus: (projectId: string, name: string, status: LaunchProcessStatus) => void;
  appendLog: (projectId: string, name: string, data: string, stream: 'stdout' | 'stderr') => void;
  clearLogs: () => void;
  clearLogsForProcess: (projectId: string, name: string) => void;
  setSelectedConfigName: (name: string | null) => void;
}

export const useSandboxStore = create<SandboxState>()((set) => ({
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigName: null,

  addCapture: (capture) => set((state) => ({ captures: [...state.captures, { id: nanoid(), ...capture }] })),

  removeCapture: (id) => set((state) => ({ captures: state.captures.filter((c) => c.id !== id) })),

  clearCaptures: () => set({ captures: [] }),

  setProcessStatus: (projectId, name, status) =>
    set((state) => ({
      processStatuses: {
        ...state.processStatuses,
        [projectId]: { ...(state.processStatuses[projectId] ?? {}), [name]: status },
      },
    })),

  appendLog: (projectId, name, data, stream) =>
    set((state) => ({
      // Keep last 500 entries to avoid unbounded growth
      logsOutput: [...state.logsOutput.slice(-499), { projectId, name, data, stream }],
    })),

  clearLogs: () => set({ logsOutput: [] }),

  clearLogsForProcess: (projectId, name) =>
    set((state) => ({
      logsOutput: state.logsOutput.filter((l) => !(l.projectId === projectId && l.name === name)),
    })),

  setSelectedConfigName: (name) => set({ selectedConfigName: name }),
}));

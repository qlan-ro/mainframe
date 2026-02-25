import { create } from 'zustand';
import { nanoid } from 'nanoid';

export interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
}

interface ProcessStatus {
  [name: string]: 'stopped' | 'starting' | 'running' | 'failed';
}

interface SandboxState {
  captures: Capture[];
  processStatuses: ProcessStatus;
  logsOutput: { name: string; data: string; stream: 'stdout' | 'stderr' }[];

  addCapture: (capture: Omit<Capture, 'id'>) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setProcessStatus: (name: string, status: ProcessStatus[string]) => void;
  appendLog: (name: string, data: string, stream: 'stdout' | 'stderr') => void;
  clearLogs: () => void;
  clearLogsForProcess: (name: string) => void;
}

export const useSandboxStore = create<SandboxState>()((set) => ({
  captures: [],
  processStatuses: {},
  logsOutput: [],

  addCapture: (capture) => set((state) => ({ captures: [...state.captures, { id: nanoid(), ...capture }] })),

  removeCapture: (id) => set((state) => ({ captures: state.captures.filter((c) => c.id !== id) })),

  clearCaptures: () => set({ captures: [] }),

  setProcessStatus: (name, status) =>
    set((state) => ({ processStatuses: { ...state.processStatuses, [name]: status } })),

  appendLog: (name, data, stream) =>
    set((state) => ({
      // Keep last 500 entries to avoid unbounded growth
      logsOutput: [...state.logsOutput.slice(-499), { name, data, stream }],
    })),

  clearLogs: () => set({ logsOutput: [] }),

  clearLogsForProcess: (name) => set((state) => ({ logsOutput: state.logsOutput.filter((l) => l.name !== name) })),
}));

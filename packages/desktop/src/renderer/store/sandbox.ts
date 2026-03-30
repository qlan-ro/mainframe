import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

export interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
}

interface SandboxState {
  captures: Capture[];
  // Scoped by scopeKey (= projectId:effectivePath) so statuses from different scopes never bleed together
  processStatuses: { [scopeKey: string]: { [name: string]: LaunchProcessStatus } };
  logsOutput: { scopeKey: string; name: string; data: string; stream: 'stdout' | 'stderr' }[];
  selectedConfigName: string | null;
  // Tracks which process was most recently started — used to auto-switch tabs
  lastStartedProcess: string | null;

  addCapture: (capture: Omit<Capture, 'id'>) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setProcessStatus: (scopeKey: string, name: string, status: LaunchProcessStatus) => void;
  appendLog: (scopeKey: string, name: string, data: string, stream: 'stdout' | 'stderr') => void;
  clearLogs: () => void;
  clearLogsForProcess: (scopeKey: string, name: string) => void;
  setSelectedConfigName: (name: string | null) => void;
  setLastStartedProcess: (name: string | null) => void;
}

export const useSandboxStore = create<SandboxState>()((set) => ({
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigName: null,
  lastStartedProcess: null,

  addCapture: (capture) => set((state) => ({ captures: [...state.captures, { id: nanoid(), ...capture }] })),

  removeCapture: (id) => set((state) => ({ captures: state.captures.filter((c) => c.id !== id) })),

  clearCaptures: () => set({ captures: [] }),

  setProcessStatus: (scopeKey, name, status) =>
    set((state) => ({
      processStatuses: {
        ...state.processStatuses,
        [scopeKey]: { ...(state.processStatuses[scopeKey] ?? {}), [name]: status },
      },
    })),

  appendLog: (scopeKey, name, data, stream) =>
    set((state) => ({
      // Keep last 500 entries to avoid unbounded growth
      logsOutput: [...state.logsOutput.slice(-499), { scopeKey, name, data, stream }],
    })),

  clearLogs: () => set({ logsOutput: [] }),

  clearLogsForProcess: (scopeKey, name) =>
    set((state) => ({
      logsOutput: state.logsOutput.filter((l) => !(l.scopeKey === scopeKey && l.name === name)),
    })),

  setSelectedConfigName: (name) => set({ selectedConfigName: name }),

  setLastStartedProcess: (name) => set({ lastStartedProcess: name }),
}));

// Expose for E2E test introspection (harmless: renderer runs inside Electron, not on the public web)
(window as Window & { __sandboxStore?: typeof useSandboxStore }).__sandboxStore = useSandboxStore;

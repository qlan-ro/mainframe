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
  // Tracks processes the user explicitly started — drives the retry/spinner logic (keyed by process name)
  freshLaunches: Record<string, boolean>;
  // Monotonically increasing counter — ensures Zustand selectors detect re-launches of the same process
  freshLaunchSeq: number;

  addCapture: (capture: Omit<Capture, 'id'>) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setProcessStatus: (projectId: string, name: string, status: LaunchProcessStatus) => void;
  /** Find status for a process name across all projects */
  getProcessStatus: (name: string) => LaunchProcessStatus;
  appendLog: (projectId: string, name: string, data: string, stream: 'stdout' | 'stderr') => void;
  clearLogs: () => void;
  clearLogsForProcess: (projectId: string, name: string) => void;
  /** Clear logs matching a process name regardless of projectId */
  clearLogsForName: (name: string) => void;
  setSelectedConfigName: (name: string | null) => void;
  markFreshLaunch: (name: string) => void;
  clearFreshLaunch: (name: string) => void;
}

export const useSandboxStore = create<SandboxState>()((set, get) => ({
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigName: null,
  freshLaunches: {},
  freshLaunchSeq: 0,

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

  getProcessStatus: (name) => {
    const { processStatuses } = get();
    for (const projStatuses of Object.values(processStatuses)) {
      const st = projStatuses[name];
      if (st) return st;
    }
    return 'stopped';
  },

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

  clearLogsForName: (name) =>
    set((state) => ({
      logsOutput: state.logsOutput.filter((l) => l.name !== name),
    })),

  setSelectedConfigName: (name) => set({ selectedConfigName: name }),

  markFreshLaunch: (name) =>
    set((state) => ({
      freshLaunches: { ...state.freshLaunches, [name]: true },
      freshLaunchSeq: state.freshLaunchSeq + 1,
    })),

  clearFreshLaunch: (name) =>
    set((state) => {
      if (!state.freshLaunches[name]) return state;
      const { [name]: _removed, ...rest } = state.freshLaunches;
      return { freshLaunches: rest };
    }),
}));

// Expose for E2E test introspection (harmless: renderer runs inside Electron, not on the public web)
(window as Window & { __sandboxStore?: typeof useSandboxStore }).__sandboxStore = useSandboxStore;

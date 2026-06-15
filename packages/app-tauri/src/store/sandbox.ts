/**
 * Sandbox Zustand store — launch process statuses, log output, and capture queue.
 *
 * Ported from packages/desktop/src/renderer/store/sandbox.ts with two changes:
 *   1. addCapture enforces a 500-entry cap (desktop is unbounded).
 *   2. The window.__sandboxStore E2E hook is dropped (use data-testid instead).
 *
 * processStatuses is keyed by scopeKey = buildLaunchScope(projectId, effectivePath)
 * so statuses from different projects / worktrees never bleed together.
 */
import { create } from 'zustand';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

const CAPTURE_CAP = 500;
const LOG_CAP = 500;

export interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
  annotation?: string;
}

export interface LogEntry {
  scopeKey: string;
  name: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

interface SandboxState {
  captures: Capture[];
  /** Keyed by scopeKey (= projectId:effectivePath), then by process name. */
  processStatuses: Record<string, Record<string, LaunchProcessStatus>>;
  logsOutput: LogEntry[];
  selectedConfigName: string | null;
  /** Tracks which process was most recently started — used to auto-switch tabs. */
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

  addCapture: (capture) =>
    set((state) => ({
      captures: [...state.captures, { id: crypto.randomUUID(), ...capture }].slice(-CAPTURE_CAP),
    })),

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
      logsOutput: [...state.logsOutput, { scopeKey, name, data, stream }].slice(-LOG_CAP),
    })),

  clearLogs: () => set({ logsOutput: [] }),

  clearLogsForProcess: (scopeKey, name) =>
    set((state) => ({
      logsOutput: state.logsOutput.filter((l) => !(l.scopeKey === scopeKey && l.name === name)),
    })),

  setSelectedConfigName: (name) => set({ selectedConfigName: name }),

  setLastStartedProcess: (name) => set({ lastStartedProcess: name }),
}));

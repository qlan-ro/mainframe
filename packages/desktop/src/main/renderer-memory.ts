/** Memory figures for a single OS process, as reported by `app.getAppMetrics()`. */
export interface ProcessMemory {
  workingSetSize: number;
  peakWorkingSetSize: number;
  privateBytes?: number;
}

interface ProcessMetricLike {
  pid: number;
  type: string;
  memory: ProcessMemory;
}

/**
 * Pick the memory figures for the renderer process out of the full app-metrics
 * list, matched by the renderer's OS process id. Returns null when the renderer
 * pid is absent (e.g. the window was destroyed between sampling and lookup).
 */
export function selectRendererMemory(osPid: number, metrics: ReadonlyArray<ProcessMetricLike>): ProcessMemory | null {
  const entry = metrics.find((m) => m.pid === osPid);
  return entry ? entry.memory : null;
}

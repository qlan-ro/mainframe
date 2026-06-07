/**
 * NewThreadConfigPicker — shown on the empty native New-thread surface.
 *
 * Resolves its own local threadId from context (useAuiState → threadListItem.id),
 * the daemon port from DaemonPortContext, and the option lists from useProjects()
 * + getAdapters(). On every valid project+adapter+mode change it writes the
 * draft-config side-channel (keyed by localId) the new-thread coordinator reads on
 * first send, then marks the local id ready in the reactive new-thread-ready-store
 * so ChatSurface switches this surface to the real composer. The chat is NEVER
 * created here (D3) — only on first send.
 *
 * Exposes data-ready="true|false" on the gate root for tests/affordances.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type { AdapterInfo, ExecutionMode } from '@qlan-ro/mainframe-types';
import { EXECUTION_MODES } from '@qlan-ro/mainframe-types';
import { getAdapters } from '../../../lib/api/adapters';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useProjects } from '../use-projects';
import { setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';

const MODE_LABELS: Record<ExecutionMode, string> = {
  default: 'Default',
  acceptEdits: 'Accept edits',
  yolo: 'YOLO (bypass)',
};

const SELECT_CLASS =
  'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function NewThreadConfigPicker({ port: portProp }: { port?: number } = {}) {
  const contextPort = useDaemonPort();
  const port = portProp ?? contextPort;
  const localId = useAuiState((s) => s.threadListItem.id);
  const { projects } = useProjects();

  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projectId, setProjectId] = useState('');
  const [adapterId, setAdapterId] = useState('');
  const [permissionMode, setPermissionMode] = useState<ExecutionMode>('default');

  useEffect(() => {
    let cancelled = false;
    getAdapters(port)
      .then((all) => {
        if (!cancelled) setAdapters(all.filter((a) => a.installed));
      })
      .catch((err: unknown) => {
        console.warn('[NewThreadConfigPicker] getAdapters failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [port]);

  const isReady = useMemo(() => Boolean(projectId && adapterId), [projectId, adapterId]);

  useEffect(() => {
    if (!isReady) return;
    // Order matters: the draft must exist before ChatSurface swaps in the composer
    // (whose first send reads the draft via the coordinator), so write it first,
    // then flip the reactive ready signal.
    setDraftConfig(localId, { projectId, adapterId, permissionMode });
    useNewThreadReady.getState().markReady(localId);
  }, [localId, projectId, adapterId, permissionMode, isReady]);

  return (
    <div
      data-testid="sessions-new-thread-send-gate"
      data-ready={String(isReady)}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <p className="text-sm font-medium text-foreground">Choose a project and adapter to start</p>

      <div className="flex flex-col gap-2">
        <label htmlFor="new-thread-project" className="text-xs text-muted-foreground">
          Project
        </label>
        <select
          id="new-thread-project"
          data-testid="sessions-new-thread-project-select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Select project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="new-thread-adapter" className="text-xs text-muted-foreground">
          Adapter
        </label>
        <select
          id="new-thread-adapter"
          data-testid="sessions-new-thread-adapter-select"
          value={adapterId}
          onChange={(e) => setAdapterId(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Select adapter…</option>
          {adapters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="new-thread-permission" className="text-xs text-muted-foreground">
          Permission mode
        </label>
        <select
          id="new-thread-permission"
          data-testid="sessions-new-thread-permission-select"
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value as ExecutionMode)}
          className={SELECT_CLASS}
        >
          {EXECUTION_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * NewThreadConfigPicker — shown on the empty New-thread surface ONLY in the "All"
 * view (no project pill selected), so the user can choose a project.
 *
 * Adapter/model/permission default to claude + the model default and are tunable
 * live in the composer toolbar afterwards (draft-aware), so the picker is just a
 * project chooser. On select it stashes the draft-config (keyed by localId) the
 * new-thread coordinator reads on first send, then marks the local id ready in the
 * reactive new-thread-ready-store so ChatSurface swaps in the composer. The chat
 * is NEVER created here (D3) — only on first send.
 *
 * Exposes data-ready="true|false" on the gate root for tests/affordances.
 */
import { useEffect, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useProjects } from '../use-projects';
import { setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';

const SELECT_CLASS =
  'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Default adapter for a new thread (matches desktop startChat); model/permission default too. */
const DEFAULT_ADAPTER_ID = 'claude';

export function NewThreadConfigPicker(_props: { port?: number } = {}) {
  const localId = useAuiState((s) => s.threadListItem.id);
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!projectId) return;
    // Order matters: the draft must exist before ChatSurface swaps in the composer
    // (whose first send reads the draft via the coordinator), so write it first,
    // then flip the reactive ready signal.
    setDraftConfig(localId, { projectId, adapterId: DEFAULT_ADAPTER_ID, permissionMode: 'default' });
    useNewThreadReady.getState().markReady(localId);
  }, [localId, projectId]);

  return (
    <div
      data-testid="sessions-new-thread-send-gate"
      data-ready={String(Boolean(projectId))}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <p className="text-sm font-medium text-foreground">Choose a project to start</p>

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
    </div>
  );
}

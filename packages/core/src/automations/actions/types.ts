// packages/core/src/automations/actions/types.ts
//
// The run_action registry's per-action contract (Task 11, ports v1
// workflows/connectors/types.ts:13 — Credentials/ActionCtx shape). v2 actions
// are flat-id (`run_command`, `github.create_pr`, `mcp:<server>:<tool>`), so
// the wire ActionCatalogEntry.id (packages/types) doubles as the registry key
// — unlike v1's two-level connector.action namespace.
import type { ZodType } from 'zod';
import type { Logger } from 'pino';
import type { ActionOutputType } from '@qlan-ro/mainframe-types';

export interface Credentials {
  kind: 'token';
  token: string;
  extra?: Record<string, string>;
}

export interface ActionCtx {
  creds: Credentials | null;
  /** `runId:stepRef:attempt` — passed through to actions that support idempotency keys (e.g. HTTP). */
  idempotencyKey: string;
  signal: AbortSignal;
  logger: Logger;
  /** ~ expansion + absolute resolution (ports v1 connectors/types.ts:18). */
  resolvePath(p: string): string;
  /** Containment base for path-validated actions (e.g. run_command's `custom` cwd, A1). */
  projectRoot: string;
  /** Set when the run targets a worktree; run_command's `worktree` cwd mode reads this directly (no containment — daemon-computed, not user text). */
  worktreePath?: string;
}

export interface ActionDef {
  id: string;
  title: string;
  group: 'builtin' | 'connector' | 'mcp';
  auth: 'none' | 'token';
  credentialLabelHint?: string;
  input: ZodType;
  outputs: Array<{ name: string; type: ActionOutputType }>;
  /** Non-idempotent actions get a persisted `running` marker before executing and are not silently re-run on restart (contract Decision 12). */
  idempotent: boolean;
  run(ctx: ActionCtx, input: unknown): Promise<Record<string, unknown>>;
}

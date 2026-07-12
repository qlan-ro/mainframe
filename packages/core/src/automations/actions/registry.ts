// packages/core/src/automations/actions/registry.ts
//
// Flat-id action registry (Task 11). Carries the `group:'mcp'` catalog seam
// but nothing registers an MCP action here at launch — that wiring is a
// post-launch task behind AUTOMATIONS_MCP_ENABLED (contract §9).
import { z } from 'zod';
import type { ActionCatalogEntry } from '@qlan-ro/mainframe-types';
import type { ActionDef } from './types.js';

export class ActionRegistry {
  private readonly actions = new Map<string, ActionDef>();

  register(action: ActionDef): void {
    this.actions.set(action.id, action);
  }

  resolve(actionId: string): ActionDef {
    const action = this.actions.get(actionId);
    if (!action) throw new Error(`unknown action '${actionId}'`);
    return action;
  }

  /** Feeds the interpreter's restart-mid-action policy (Decision 12): unregistered ids are treated as non-idempotent. */
  isIdempotent(actionId: string): boolean {
    return this.actions.get(actionId)?.idempotent ?? false;
  }

  catalog(): ActionCatalogEntry[] {
    return [...this.actions.values()].map((action) => ({
      id: action.id,
      title: action.title,
      group: action.group,
      auth: action.auth,
      credentialLabelHint: action.credentialLabelHint,
      paramsSchema: z.toJSONSchema(action.input),
      outputs: action.outputs,
    }));
  }
}

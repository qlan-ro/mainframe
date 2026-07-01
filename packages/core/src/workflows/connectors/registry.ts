// packages/core/src/workflows/connectors/registry.ts
import { z } from 'zod';
import type { ActionDef, Connector } from './types.js';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  resolve(dotted: string): { connector: Connector; action: ActionDef } {
    const [connectorId, actionId] = dotted.split('.');
    const connector = this.connectors.get(connectorId ?? '');
    if (!connector) throw new Error(`unknown connector '${connectorId}'`);
    const action = connector.actions[actionId ?? ''];
    if (!action) throw new Error(`unknown action '${actionId}' on connector '${connectorId}'`);
    return { connector, action };
  }

  catalog(): Array<{
    id: string;
    title: string;
    auth: Connector['auth'];
    actions: Array<{ id: string; title: string; idempotent: boolean; inputSchema: unknown; outputSchema: unknown }>;
  }> {
    return [...this.connectors.values()].map((c) => ({
      id: c.id,
      title: c.title,
      auth: c.auth,
      actions: Object.entries(c.actions).map(([id, a]) => ({
        id,
        title: a.title,
        idempotent: a.idempotent,
        inputSchema: z.toJSONSchema(a.input),
        outputSchema: z.toJSONSchema(a.output),
      })),
    }));
  }
}

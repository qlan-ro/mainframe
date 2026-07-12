// packages/core/src/__tests__/automations/action-registry.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ActionRegistry } from '../../automations/actions/registry.js';
import type { ActionDef } from '../../automations/actions/types.js';

function fakeAction(overrides: Partial<ActionDef> = {}): ActionDef {
  return {
    id: 'test.echo',
    title: 'Echo',
    group: 'builtin',
    auth: 'none',
    input: z.object({ text: z.string() }),
    outputs: [{ name: 'text', type: 'text' }],
    idempotent: true,
    async run(_ctx, input) {
      return { text: (input as { text: string }).text };
    },
    ...overrides,
  };
}

describe('ActionRegistry', () => {
  it('registers and resolves an action by its flat id', () => {
    const registry = new ActionRegistry();
    const action = fakeAction();
    registry.register(action);
    expect(registry.resolve('test.echo')).toBe(action);
  });

  it('resolve throws for an unknown action id', () => {
    const registry = new ActionRegistry();
    expect(() => registry.resolve('nope')).toThrow(/unknown action/);
  });

  it('isIdempotent reflects the registered action and is false for unregistered ids', () => {
    const registry = new ActionRegistry();
    registry.register(fakeAction({ id: 'idempotent-op', idempotent: true }));
    registry.register(fakeAction({ id: 'risky-op', idempotent: false }));
    expect(registry.isIdempotent('idempotent-op')).toBe(true);
    expect(registry.isIdempotent('risky-op')).toBe(false);
    expect(registry.isIdempotent('unregistered')).toBe(false);
  });

  it('catalog() maps every registered action to an ActionCatalogEntry with a JSON-schema paramsSchema', () => {
    const registry = new ActionRegistry();
    registry.register(fakeAction());
    expect(registry.catalog()).toEqual([
      {
        id: 'test.echo',
        title: 'Echo',
        group: 'builtin',
        auth: 'none',
        credentialLabelHint: undefined,
        paramsSchema: z.toJSONSchema(z.object({ text: z.string() })),
        outputs: [{ name: 'text', type: 'text' }],
      },
    ]);
  });

  it('carries the mcp seam: a group:"mcp" action registers and catalogs like any other', () => {
    const registry = new ActionRegistry();
    registry.register(fakeAction({ id: 'mcp:server:tool', group: 'mcp' }));
    const entry = registry.catalog().find((e) => e.id === 'mcp:server:tool');
    expect(entry?.group).toBe('mcp');
  });
});

// packages/core/src/__tests__/workflows/connector-registry.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';
import type { Connector } from '../../workflows/connectors/types.js';

const echo: Connector = {
  id: 'echo',
  title: 'Echo',
  auth: { kind: 'none' },
  actions: {
    say: {
      title: 'Say',
      input: z.object({ text: z.string() }),
      output: z.object({ said: z.string() }),
      idempotent: true,
      async run(_ctx, input) {
        return { said: (input as { text: string }).text };
      },
    },
  },
};

describe('ConnectorRegistry', () => {
  it('registers and resolves dotted action names', () => {
    const reg = new ConnectorRegistry();
    reg.register(echo);
    const { connector, action } = reg.resolve('echo.say');
    expect(connector.id).toBe('echo');
    expect(action.title).toBe('Say');
  });

  it('throws a clear error for unknown connector or action', () => {
    const reg = new ConnectorRegistry();
    reg.register(echo);
    expect(() => reg.resolve('nope.say')).toThrow(/unknown connector 'nope'/);
    expect(() => reg.resolve('echo.nope')).toThrow(/unknown action 'nope'/);
  });

  it('lists the catalog with JSON schemas for the editor', () => {
    const reg = new ConnectorRegistry();
    reg.register(echo);
    const catalog = reg.catalog();
    expect(catalog[0]?.actions[0]?.inputSchema).toMatchObject({ type: 'object' });
  });
});

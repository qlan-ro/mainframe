// Convert the daemon's exported Zod schemas to JSON Schema (zod v4 native
// z.toJSONSchema). Inline module-local schemas that aren't exported can't be
// imported, so route analysis falls back to capturing their Zod source text.
import { z } from 'zod';

const SCHEMA_MODULES = [
  ['schemas.ts', '../../src/server/routes/schemas.ts'],
  ['ws-schemas.ts', '../../src/server/ws-schemas.ts'],
];

function isZodSchema(value) {
  return !!value && typeof value === 'object' && typeof value.safeParse === 'function';
}

export function toJsonSchema(schema) {
  try {
    // io:'input' captures the pre-transform shape a client must send.
    return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
  } catch {
    return { note: 'zod schema could not be represented as JSON Schema' };
  }
}

/**
 * Build a registry of every exported Zod schema across the schema modules,
 * keyed by identifier name → { jsonSchema, source }. Used to resolve request
 * schema identifiers referenced by route handlers.
 */
export async function buildSchemaRegistry() {
  const registry = new Map();
  for (const [label, modPath] of SCHEMA_MODULES) {
    const mod = await import(new URL(modPath, import.meta.url).href);
    for (const [name, value] of Object.entries(mod)) {
      if (!isZodSchema(value)) continue;
      registry.set(name, { jsonSchema: toJsonSchema(value), source: `${label}:${name}` });
    }
  }
  return registry;
}

// Parse the DaemonEvent (server→client) and ClientEvent (client→server) unions
// from packages/types/src/events.ts with the TypeScript AST. These are plain TS
// types (no runtime value to import), so the AST is the source of truth for
// each variant's `type` discriminator and payload fields. Client events are
// additionally validated at runtime by ws-schemas.ts, whose JSON Schema we
// attach for the wire-validation contract.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { toJsonSchema } from './zod-json.mjs';

const EVENTS_FILE = new URL('../../../types/src/events.ts', import.meta.url);

function literalValue(text) {
  const m = text.match(/^'([^']*)'$/) || text.match(/^"([^"]*)"$/);
  return m ? m[1] : null;
}

function memberFromTypeLiteral(typeNode, sf) {
  if (!ts.isTypeLiteralNode(typeNode)) return null;
  let type = null;
  const fields = [];
  for (const m of typeNode.members) {
    if (!ts.isPropertySignature(m) || !m.name) continue;
    const name = m.name.getText(sf);
    const typeText = (m.type ? m.type.getText(sf) : 'unknown').replace(/\s+/g, ' ');
    if (name === 'type') {
      type = literalValue(typeText);
      continue;
    }
    fields.push({ name, optional: !!m.questionToken, type: typeText });
  }
  return { type, fields };
}

function parseUnion(sf, aliasName) {
  let members = null;
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) {
      const t = node.type;
      const nodes = ts.isUnionTypeNode(t) ? t.types : [t];
      members = nodes.map((n) => memberFromTypeLiteral(n, sf)).filter(Boolean);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!members) throw new Error(`Type alias ${aliasName} not found in events.ts`);
  return members;
}

/** Parse both unions; returns { daemonEvents, clientEvents } sorted by `type`. */
export function parseEventUnions() {
  const src = readFileSync(EVENTS_FILE, 'utf8');
  const sf = ts.createSourceFile('events.ts', src, ts.ScriptTarget.Latest, true);
  const byType = (a, b) => String(a.type).localeCompare(String(b.type));
  return {
    daemonEvents: parseUnion(sf, 'DaemonEvent').sort(byType),
    clientEvents: parseUnion(sf, 'ClientEvent').sort(byType),
  };
}

/**
 * Attach the runtime Zod validation schema (ws-schemas.ts ClientEventSchema) to
 * each client event `type`. Returns Map<type, jsonSchema>.
 */
export async function clientEventSchemas() {
  const mod = await import(new URL('../../src/server/ws-schemas.ts', import.meta.url).href);
  const union = mod.ClientEventSchema;
  const options = union.options ?? union.def?.options ?? [];
  const map = new Map();
  for (const opt of options) {
    const json = toJsonSchema(opt);
    const typeConst = json?.properties?.type?.const ?? json?.properties?.type?.enum?.[0] ?? null;
    if (typeConst) map.set(typeConst, json);
  }
  return map;
}

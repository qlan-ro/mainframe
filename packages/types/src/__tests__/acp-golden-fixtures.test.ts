/**
 * Golden round-trip harness over every fixture in
 * `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/` — the same
 * bytes the Rust round-trip tests in `mainframe_types::acp` consume (todo
 * #350, plan task 3). Mirrors `acp_golden_fixtures.rs`: dispatch each
 * fixture file to its Zod schema by filename prefix, `parse`, re-serialize,
 * and assert deep equality with the original after stripping the
 * fixture-only `_provenance` key.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GateResolvedParamsSchema,
  HeartbeatParamsSchema,
  ItemMetaSchema,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MainframeCapabilitiesSchema,
  PromptSendMetaSchema,
  QueuedPromptStateSchema,
  CompactionParamsSchema,
  QueueStateParamsSchema,
  ResyncParamsSchema,
  SessionDetachParamsSchema,
  TranscriptClearedParamsSchema,
  RetryMarkerSchema,
  UsageMetaSchema,
  RichPermissionAnswerSchema,
  StructuredDiffSchema,
  TruncationMarkerSchema,
} from '../acp/index.js';
import {
  CancelSessionNotificationSchema,
  InitializeRequestSchema,
  InitializeResponseSchema,
  NewSessionRequestSchema,
  NewSessionResponseSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  ResumeSessionRequestSchema,
  ResumeSessionResponseSchema,
} from '../acp/session.js';
import { RequestPermissionRequestSchema, RequestPermissionResponseSchema } from '../acp/permission.js';
import { UpdateSessionNotificationSchema } from '../acp/update.js';

function fixturesDir(): string {
  return fileURLToPath(
    new URL('../../../../packages/core-rs/crates/mainframe-types/tests/fixtures/acp/', import.meta.url),
  );
}

function readFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(fixturesDir() + name, 'utf8');
  const { _provenance, ...body } = JSON.parse(raw) as Record<string, unknown>;
  expect(_provenance).toBe('synthetic');
  return body;
}

/** Filename prefix → Zod schema. Mirrors `acp_golden_fixtures.rs`'s dispatch table. */
function schemaFor(name: string): z.ZodType {
  if (name === 'queue-state.notification.json') return JsonRpcNotificationSchema;
  if (name === 'queue-state.params.json') return QueueStateParamsSchema;
  if (name === 'transcript-cleared.notification.json') return JsonRpcNotificationSchema;
  if (name === 'transcript-cleared.params.json') return TranscriptClearedParamsSchema;
  if (name === 'session-detach.notification.json') return JsonRpcNotificationSchema;
  if (name === 'session-detach.params.json') return SessionDetachParamsSchema;
  if (name === 'resync.notification.json') return JsonRpcNotificationSchema;
  if (name === 'resync.params.json') return ResyncParamsSchema;
  if (name === 'compaction.notification.json') return JsonRpcNotificationSchema;
  if (name === 'compaction.params.json') return CompactionParamsSchema;
  if (name === 'heartbeat.notification.json') return JsonRpcNotificationSchema;
  if (name === 'heartbeat.params.json') return HeartbeatParamsSchema;
  if (name === 'gate-resolved.notification.json') return JsonRpcNotificationSchema;
  if (name === 'gate-resolved.params.json') return GateResolvedParamsSchema;
  if (name.startsWith('extensions.capabilities')) return MainframeCapabilitiesSchema;
  if (name.startsWith('extensions.usage-meta')) return UsageMetaSchema;
  if (name.startsWith('extensions.retry-marker')) return RetryMarkerSchema;
  if (name.startsWith('extensions.item-meta')) return ItemMetaSchema;
  if (name.startsWith('extensions.prompt-send-meta')) return PromptSendMetaSchema;
  if (name.startsWith('extensions.queued-state')) return QueuedPromptStateSchema;
  if (name.startsWith('extensions.rich-permission-answer')) return RichPermissionAnswerSchema;
  if (name.startsWith('extensions.structured-diff')) return StructuredDiffSchema;
  if (name.startsWith('extensions.truncation-marker')) return TruncationMarkerSchema;
  if (name.startsWith('jsonrpc-request.')) return JsonRpcRequestSchema;
  if (name.startsWith('jsonrpc-response.')) return JsonRpcResponseSchema;
  if (name.startsWith('jsonrpc-notification.')) return JsonRpcNotificationSchema;
  if (name.startsWith('initialize.request')) return InitializeRequestSchema;
  if (name.startsWith('initialize.response')) return InitializeResponseSchema;
  if (name.startsWith('session-new.request')) return NewSessionRequestSchema;
  if (name.startsWith('session-new.response')) return NewSessionResponseSchema;
  if (name.startsWith('session-prompt.request')) return PromptRequestSchema;
  if (name.startsWith('session-prompt.response')) return PromptResponseSchema;
  if (name.startsWith('session-cancel.notification')) return CancelSessionNotificationSchema;
  if (name.startsWith('session-resume.request')) return ResumeSessionRequestSchema;
  if (name.startsWith('session-resume.response')) return ResumeSessionResponseSchema;
  if (name.startsWith('session-update.')) return UpdateSessionNotificationSchema;
  if (name.startsWith('permission.request')) return RequestPermissionRequestSchema;
  if (name.startsWith('permission.response')) return RequestPermissionResponseSchema;
  throw new Error(`${name}: no dispatch arm — add one in acp-golden-fixtures.test.ts`);
}

const fixtureNames = readdirSync(fixturesDir()).filter((n) => n.endsWith('.json'));

/**
 * A key-set comparison on parse output cannot catch a Rust-required field
 * left unmodelled in TS: every schema here is `.loose()`, so an unknown key
 * survives `parse` unchanged and the round-trip equality above holds by
 * construction (todo #350, R2.10). The oracle instead is the schema's own
 * declared shape, read through `z.toJSONSchema` rather than re-parsing the
 * fixture — a `properties` object with no matching key for something the
 * fixture actually sent is the drift this test exists to catch.
 */
interface JsonSchemaNode {
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  const?: unknown;
}

/**
 * How well `branch` fits `value`: literal (`const`) agreement counts far
 * more than plain key overlap, so a tag match wins over a bigger shape, but
 * key overlap still breaks ties among branches that share one discriminator
 * and differ on a second tag — `update.ts`'s flattened `state_update`
 * family (`sessionUpdate` shared, `state` distinguishes) and `jsonrpc.ts`'s
 * result/error split (`jsonrpc` shared, `result`/`error` distinguishes).
 */
function branchFit(branch: JsonSchemaNode, value: Record<string, unknown>): number {
  const properties = branch.properties ?? {};
  let constMatches = 0;
  let keyOverlap = 0;
  for (const [key, node] of Object.entries(properties)) {
    if (!(key in value)) continue;
    keyOverlap += 1;
    if ('const' in node && value[key] === node.const) constMatches += 1;
  }
  return constMatches * 1000 + keyOverlap;
}

/** The best-matching object-shaped branch, or `undefined` if every branch is open (`z.unknown()`, a bare `null` arm) and the key set is unconstrained by construction. */
function branchFor(branches: JsonSchemaNode[], value: Record<string, unknown>): JsonSchemaNode | undefined {
  const candidates = branches.filter((branch) => branch.properties);
  if (candidates.length === 0) return undefined;
  const [best] = candidates.map((branch) => [branch, branchFit(branch, value)] as const).sort(([, a], [, b]) => b - a);
  return best?.[0];
}

function collectUndeclaredKeys(node: JsonSchemaNode, value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    if (node.items) value.forEach((item, i) => collectUndeclaredKeys(node.items!, item, `${path}[${i}]`, out));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;

  const branches = node.oneOf ?? node.anyOf;
  if (branches) {
    const matched = branchFor(branches, object);
    if (matched) collectUndeclaredKeys(matched, value, path, out);
    return;
  }

  // No `properties` at this node means an open map (`z.record`) or an
  // opaque field (`z.unknown()`/`z.custom()`) — every key is allowed.
  if (!node.properties) return;

  for (const [key, child] of Object.entries(object)) {
    const childSchema = node.properties[key];
    if (!childSchema) out.push(`${path}.${key}`);
    else collectUndeclaredKeys(childSchema, child, `${path}.${key}`, out);
  }
}

describe('acp/*.json fixtures validate and round-trip through their Zod schema', () => {
  it('covers every fixture in the directory', () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  it.each(fixtureNames)('%s', (name) => {
    const body = readFixture(name);
    const schema = schemaFor(name);
    const parsed = schema.parse(body);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(body);
  });

  it('rejects a malformed frame instead of silently coercing it', () => {
    const result = InitializeRequestSchema.safeParse({ protocolVersion: 'two', info: { name: 'x' } });
    expect(result.success).toBe(false);
  });

  it('tolerates an unknown permission-option kind, preserved verbatim (spec decision 25)', () => {
    const result = RequestPermissionRequestSchema.safeParse({
      sessionId: 'chat_1',
      title: 'Allow?',
      options: [{ optionId: 'x', name: 'Allow', kind: 'maybe_once' }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.options[0]?.kind).toBe('maybe_once');
  });
});

describe('every fixture key is declared in its schema (R2.10)', () => {
  it.each(fixtureNames)('%s', (name) => {
    const body = readFixture(name);
    const schema = schemaFor(name);
    const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' }) as JsonSchemaNode;
    const undeclared: string[] = [];
    collectUndeclaredKeys(jsonSchema, body, name, undeclared);
    expect(undeclared).toEqual([]);
  });
});

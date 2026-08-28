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
import type { z } from 'zod';
import {
  HeartbeatParamsSchema,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  MainframeCapabilitiesSchema,
  QueuedPromptStateSchema,
  RetryMarkerSchema,
  RichPermissionAnswerSchema,
  StructuredDiffSchema,
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
  if (name === 'heartbeat.notification.json') return JsonRpcNotificationSchema;
  if (name === 'heartbeat.params.json') return HeartbeatParamsSchema;
  if (name.startsWith('extensions.capabilities')) return MainframeCapabilitiesSchema;
  if (name.startsWith('extensions.retry-marker')) return RetryMarkerSchema;
  if (name.startsWith('extensions.queued-state')) return QueuedPromptStateSchema;
  if (name.startsWith('extensions.rich-permission-answer')) return RichPermissionAnswerSchema;
  if (name.startsWith('extensions.structured-diff')) return StructuredDiffSchema;
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

  it('rejects an unknown permission-option kind', () => {
    const result = RequestPermissionRequestSchema.safeParse({
      sessionId: 'chat_1',
      title: 'Allow?',
      options: [{ optionId: 'x', name: 'Allow', kind: 'maybe_once' }],
    });
    expect(result.success).toBe(false);
  });
});

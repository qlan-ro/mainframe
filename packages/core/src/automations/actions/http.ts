// packages/core/src/automations/actions/http.ts
//
// Ports v1 workflows/connectors/http.ts onto the flat-id v2 registry (Task
// 13). Output shape changes (contract §5): `headers` is dropped and `body`
// is always raw response text — no content-type-based JSON parsing — since
// the wire ActionOutputType has no structured "unknown" variant. Preserves
// v1's throw-on-non-2xx behavior (mirrors run_command's non-zero-exit
// failure convention) since the contract doesn't otherwise specify branching
// semantics for error responses.
import { z } from 'zod';
import type { ActionDef } from './types.js';

const HttpRequestInputSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).default(30_000),
  })
  .strict();

type HttpRequestInput = z.infer<typeof HttpRequestInputSchema>;

function buildPayload(body: HttpRequestInput['body'], headers: Headers): string | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(body);
}

export const httpRequestAction: ActionDef = {
  id: 'http.request',
  title: 'HTTP request',
  group: 'builtin',
  auth: 'token',
  input: HttpRequestInputSchema,
  outputs: [
    { name: 'status', type: 'number' },
    { name: 'body', type: 'text' },
  ],
  idempotent: false,
  async run(ctx, rawInput) {
    const input = HttpRequestInputSchema.parse(rawInput);
    const headers = new Headers(input.headers);
    if (ctx.creds && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${ctx.creds.token}`);
    }
    headers.set('x-idempotency-key', ctx.idempotencyKey);
    const payload = buildPayload(input.body, headers);
    const res = await fetch(input.url, {
      method: input.method,
      headers,
      body: payload,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(input.timeoutMs)]),
    });
    const body = await res.text();
    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status} from ${input.url}: ${body.slice(0, 500)}`);
    }
    return { status: res.status, body };
  },
};

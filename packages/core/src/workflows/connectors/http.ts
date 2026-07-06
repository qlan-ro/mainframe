import { z } from 'zod';
import type { Connector } from './types.js';

export const httpConnector: Connector = {
  id: 'http',
  title: 'HTTP requests',
  auth: { kind: 'token' },
  actions: {
    request: {
      title: 'HTTP request',
      input: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
        timeoutMs: z.number().int().min(1).max(120_000).default(30_000),
      }),
      output: z.object({ status: z.number(), headers: z.record(z.string(), z.string()), body: z.unknown() }),
      idempotent: false,
      async run(ctx, input) {
        const { method, url, headers, body, timeoutMs } = input as {
          method: string;
          url: string;
          headers?: Record<string, string>;
          body?: unknown;
          timeoutMs: number;
        };
        const h = new Headers(headers);
        if (ctx.creds && !h.has('authorization')) {
          h.set('authorization', `Bearer ${ctx.creds.token}`);
        }
        h.set('x-idempotency-key', ctx.idempotencyKey);
        const payload = buildPayload(body, h);
        const res = await fetch(url, {
          method,
          headers: h,
          body: payload,
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
        });
        const text = await res.text();
        const parsed = parseBody(text, res.headers.get('content-type') ?? '', url, ctx.logger);
        const outHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          outHeaders[k] = v;
        });
        if (res.status >= 400) {
          throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 500)}`);
        }
        return { status: res.status, headers: outHeaders, body: parsed };
      },
    },
  },
};

function buildPayload(body: unknown, h: Headers): string | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (!h.has('content-type')) h.set('content-type', 'application/json');
  return JSON.stringify(body);
}

function parseBody(text: string, contentType: string, url: string, logger: import('pino').Logger): unknown {
  if (!contentType.includes('application/json')) return text;
  try {
    return JSON.parse(text);
  } catch (err) {
    logger.warn({ err: String(err), url }, 'http: content-type json but body unparseable; returning raw text');
    return text;
  }
}

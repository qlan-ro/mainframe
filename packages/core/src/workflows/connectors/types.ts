// packages/core/src/workflows/connectors/types.ts
import type { ZodType } from 'zod';
import type { Logger } from 'pino';

export interface Credentials {
  kind: 'token';
  token: string;
  extra?: Record<string, string>;
}

export type AuthDescriptor = { kind: 'none' } | { kind: 'token'; help?: string };

export interface ActionCtx {
  creds: Credentials | null;
  idempotencyKey: string; // runId:stepPath:attempt
  signal: AbortSignal;
  logger: Logger;
  resolvePath(p: string): string; // ~ expansion + absolute resolution
}

export interface ActionDef {
  title: string;
  input: ZodType;
  output: ZodType;
  idempotent: boolean;
  run(ctx: ActionCtx, input: unknown): Promise<unknown>;
}

export interface Connector {
  id: string;
  title: string;
  auth: AuthDescriptor;
  actions: Record<string, ActionDef>;
}

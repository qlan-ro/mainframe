import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ConnectorRegistry } from '../../connectors/registry.js';
import type { Credentials } from '../../connectors/types.js';
import type { ConnectorStep } from '../../dsl/types.js';
import type { StepContext, StepOutcome } from '../types.js';
import { renderValue } from '../../template/render.js';

export type CredentialResolver = (label: string) => Credentials | null;

export function makeConnectorExecutor(registry: ConnectorRegistry, resolveCredential: CredentialResolver) {
  return async function executeConnector(ctx: StepContext, step: ConnectorStep): Promise<StepOutcome> {
    const { action } = registry.resolve(step.connector);
    const rendered = await renderValue(step.with ?? {}, ctx.scope);
    const parsed = action.input.safeParse(rendered);
    if (!parsed.success) {
      return {
        type: 'failed',
        error: `invalid input for ${step.connector}: ${parsed.error.message}`,
        retryable: false,
      };
    }
    const creds = step.credential ? resolveCredential(step.credential) : null;
    if (step.credential && !creds) {
      return {
        type: 'failed',
        error: `credential '${step.credential}' not found — add it via PUT /api/workflow-credentials/${step.credential}`,
        retryable: false,
      };
    }
    try {
      const result = await action.run(
        {
          creds,
          idempotencyKey: `${ctx.run.id}:${ctx.stepPath}:${ctx.attempt}`,
          signal: ctx.signal,
          logger: ctx.logger,
          resolvePath: (p) => resolve(p.startsWith('~') ? p.replace(/^~(?=$|\/)/, homedir()) : p),
        },
        parsed.data,
      );
      const out = action.output.safeParse(result);
      if (!out.success) {
        return {
          type: 'failed',
          error: `connector ${step.connector} returned invalid output: ${out.error.message}`,
          retryable: false,
        };
      }
      return { type: 'completed', output: out.data };
    } catch (err) {
      return {
        type: 'failed',
        error: String(err instanceof Error ? err.message : err),
        retryable: true,
      };
    }
  };
}

// packages/core/src/__tests__/automations/run-action-executor.test.ts
//
// Task 23: the run_action arm of VerbPorts. Every action's ChipText params
// are rendered to a single joined string EXCEPT run_command's `script`
// param, which keeps chip boundaries as raw `{literal}|{chip}` parts (A1) —
// this is the one behavioral seam the executor adds on top of a plain
// registry.resolve() + action.run() call.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import pino from 'pino';
import type { RunActionStep } from '@qlan-ro/mainframe-types';
import { ActionRegistry } from '../../automations/actions/registry.js';
import type { ActionDef, Credentials } from '../../automations/actions/types.js';
import { makeRunActionExecutor } from '../../automations/verbs/run-action.js';
import type { VerbContext } from '../../automations/engine/types.js';

const silentLogger = pino({ level: 'silent' });

function fakeAction(overrides: Partial<ActionDef> = {}): ActionDef {
  return {
    id: 'test.echo',
    title: 'Echo',
    group: 'builtin',
    auth: 'none',
    input: z.object({ text: z.string() }).strict(),
    outputs: [{ name: 'text', type: 'text' }],
    idempotent: true,
    async run(_ctx, input) {
      return { text: (input as { text: string }).text };
    },
    ...overrides,
  };
}

function ctxFor(overrides: Partial<VerbContext> = {}): VerbContext {
  return {
    runId: 'run-1',
    stepRef: 'step-1',
    tokens: {
      trigger: {},
      steps: {
        prev: {
          stepId: 'prev',
          kind: 'notify',
          status: 'succeeded',
          outputs: { name: 'World' },
          error: null,
          startedAt: 0,
          finishedAt: 0,
        },
      },
      currentItems: [],
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeExecutor(opts: {
  registry: ActionRegistry;
  resolveCredential?: (label: string) => Credentials | null;
  resolveProjectRoot?: (runId: string) => string;
}) {
  return makeRunActionExecutor({
    registry: opts.registry,
    resolveCredential: opts.resolveCredential ?? (() => null),
    resolveProjectRoot: opts.resolveProjectRoot ?? (() => '/proj'),
    logger: silentLogger,
  });
}

describe('run_action executor', () => {
  it('renders every ChipText param into a single joined string for a normal action', async () => {
    let received: unknown;
    const action = fakeAction({
      input: z.object({ text: z.string() }).strict(),
      async run(_ctx, input) {
        received = input;
        return { text: 'ok' };
      },
    });
    const registry = new ActionRegistry();
    registry.register(action);
    const executor = makeExecutor({ registry });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'test.echo',
      params: { text: ['Hello, ', { token: { stepId: 'prev', output: 'name' } }, '!'] },
    };
    const outcome = await executor(step, ctxFor());

    expect(outcome).toEqual({ type: 'completed', outputs: { text: 'ok' } });
    expect(received).toEqual({ text: 'Hello, World!' });
  });

  it('run_command keeps script chip boundaries as raw {literal}|{chip} parts', async () => {
    let received: unknown;
    const action = fakeAction({
      id: 'run_command',
      input: z
        .object({
          script: z.array(
            z.union([z.object({ literal: z.string() }).strict(), z.object({ chip: z.string() }).strict()]),
          ),
          runIn: z.string(),
        })
        .strict(),
      async run(_ctx, input) {
        received = input;
        return { output: 'ran', exitCode: 0 };
      },
    });
    const registry = new ActionRegistry();
    registry.register(action);
    const executor = makeExecutor({ registry });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'run_command',
      params: {
        script: ['echo ', { token: { stepId: 'prev', output: 'name' } }],
        runIn: ['project root'],
      },
    };
    const outcome = await executor(step, ctxFor());

    expect(outcome).toEqual({ type: 'completed', outputs: { output: 'ran', exitCode: 0 } });
    expect(received).toEqual({
      script: [{ literal: 'echo ' }, { chip: 'World' }],
      runIn: 'project root',
    });
  });

  it('merges step.outputAs into run_command input but not into an action without that field', async () => {
    let received: unknown;
    const runCommand = fakeAction({
      id: 'run_command',
      input: z
        .object({
          script: z.array(
            z.union([z.object({ literal: z.string() }).strict(), z.object({ chip: z.string() }).strict()]),
          ),
          outputAs: z.enum(['text', 'lines']).optional(),
        })
        .strict(),
      async run(_ctx, input) {
        received = input;
        return {};
      },
    });
    const registry = new ActionRegistry();
    registry.register(runCommand);
    const executor = makeExecutor({ registry });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'run_command',
      params: { script: ['echo hi'] },
      outputAs: 'lines',
    };
    await executor(step, ctxFor());

    expect(received).toEqual({ script: [{ literal: 'echo hi' }], outputAs: 'lines' });
  });

  it('does not inject outputAs into an action whose schema rejects unknown keys', async () => {
    const strictAction = fakeAction({ id: 'notion.add_row', input: z.object({ databaseId: z.string() }).strict() });
    const registry = new ActionRegistry();
    registry.register(strictAction);
    const executor = makeExecutor({ registry });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'notion.add_row',
      params: { databaseId: ['db-1'] },
      outputAs: 'text',
    };
    const outcome = await executor(step, ctxFor());

    expect(outcome.type).toBe('completed');
  });

  it('fails cleanly for an unknown actionId', async () => {
    const registry = new ActionRegistry();
    const executor = makeExecutor({ registry });

    const step: RunActionStep = { id: 'step-1', kind: 'run_action', actionId: 'missing.action', params: {} };
    const outcome = await executor(step, ctxFor());

    expect(outcome).toEqual({ type: 'failed', error: expect.stringContaining('missing.action') });
  });

  it('fails when a declared credential label is not found', async () => {
    const registry = new ActionRegistry();
    registry.register(fakeAction({ auth: 'token' }));
    const executor = makeExecutor({ registry, resolveCredential: () => null });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'test.echo',
      credential: 'github',
      params: { text: ['hi'] },
    };
    const outcome = await executor(step, ctxFor());

    expect(outcome).toEqual({ type: 'failed', error: expect.stringContaining("credential 'github' not found") });
  });

  it('passes the resolved credential through to the action', async () => {
    let seenCreds: Credentials | null = null;
    const registry = new ActionRegistry();
    registry.register(
      fakeAction({
        auth: 'token',
        async run(ctx, input) {
          seenCreds = ctx.creds;
          return { text: (input as { text: string }).text };
        },
      }),
    );
    const creds: Credentials = { kind: 'token', token: 'shh' };
    const executor = makeExecutor({ registry, resolveCredential: () => creds });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'test.echo',
      credential: 'github',
      params: { text: ['hi'] },
    };
    await executor(step, ctxFor());

    expect(seenCreds).toEqual(creds);
  });

  it('fails with the zod message when rendered params do not satisfy the input schema', async () => {
    const registry = new ActionRegistry();
    registry.register(fakeAction({ input: z.object({ count: z.number() }).strict() }));
    const executor = makeExecutor({ registry });

    const step: RunActionStep = {
      id: 'step-1',
      kind: 'run_action',
      actionId: 'test.echo',
      params: { count: ['not-a-number'] },
    };
    const outcome = await executor(step, ctxFor());

    expect(outcome.type).toBe('failed');
  });

  it('turns a thrown action error into a failed outcome instead of crashing', async () => {
    const registry = new ActionRegistry();
    registry.register(
      fakeAction({
        async run() {
          throw new Error('boom');
        },
      }),
    );
    const executor = makeExecutor({ registry });

    const step: RunActionStep = { id: 'step-1', kind: 'run_action', actionId: 'test.echo', params: { text: ['hi'] } };
    const outcome = await executor(step, ctxFor());

    expect(outcome).toEqual({ type: 'failed', error: 'boom' });
  });

  it('resolves projectRoot per run and passes it through ActionCtx', async () => {
    let seenRoot: string | undefined;
    const registry = new ActionRegistry();
    registry.register(
      fakeAction({
        async run(ctx, input) {
          seenRoot = ctx.projectRoot;
          return { text: (input as { text: string }).text };
        },
      }),
    );
    const executor = makeExecutor({ registry, resolveProjectRoot: (runId) => `/projects/${runId}` });

    const step: RunActionStep = { id: 'step-1', kind: 'run_action', actionId: 'test.echo', params: { text: ['hi'] } };
    await executor(step, ctxFor({ runId: 'run-42' }));

    expect(seenRoot).toBe('/projects/run-42');
  });
});

// packages/core/src/__tests__/automations/conformance-blocks.test.ts
//
// Task 27 (spec §12): reference automations 4-6, loaded via loadFixture. Same
// fake-registry/fake-agent-port methodology as conformance-basic.test.ts
// (Task 26), except the feature-spike fixture, which the plan requires
// running against the REAL makeAutomationChatPort (contract §9) so a fake
// port can't hide the missing ChatManager autoApprove/timeoutMinutes param.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import pino from 'pino';
import type { AskAgentStep, DaemonEvent, IfBlock, NotifyStep, RunActionStep } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';
import { ActionRegistry } from '../../automations/actions/registry.js';
import type { ActionDef } from '../../automations/actions/types.js';
import { runCommandAction } from '../../automations/actions/run-command.js';
import { makeRunActionExecutor } from '../../automations/verbs/run-action.js';
import { makeAskMeExecutor, InteractionService } from '../../automations/verbs/ask-me.js';
import { makeAskAgentExecutor, type AgentChatPort } from '../../automations/verbs/ask-agent.js';
import { AgentWaitService } from '../../automations/verbs/agent-waits.js';
import { makeAutomationChatPort } from '../../automations/agent-port.js';
import { renderChipText } from '../../automations/tokens/substitute.js';
import { loadFixture } from '../../automations/testing/fixtures.js';

const MANUAL: AutomationRunTriggerContext = { kind: 'manual' };
const silentLogger = pino({ level: 'silent' });

function seedAutomation(db: AutomationDb, id: string, name: string): void {
  db.prepare(
    `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
     VALUES (?, ?, 'global', 1, '{}', 0, 0)`,
  ).run(id, name);
}

function neverCalled(name: string) {
  return async (): Promise<StepOutcome> => {
    throw new Error(`unexpected call to VerbPorts.${name}`);
  };
}

function fakePorts(overrides: Partial<VerbPorts> = {}): VerbPorts {
  return {
    runAction: neverCalled('runAction'),
    askAgent: neverCalled('askAgent'),
    askMe: neverCalled('askMe'),
    notify: neverCalled('notify'),
    ...overrides,
  };
}

/** Records every call and returns a canned output — never touches a real network or filesystem. */
function fakeAction(
  id: string,
  outputs: Record<string, unknown>,
  calls: Array<{ actionId: string; input: unknown }>,
): ActionDef {
  return {
    id,
    title: id,
    group: 'connector',
    auth: 'none',
    input: z.record(z.string(), z.unknown()),
    outputs: [],
    idempotent: false,
    async run(_ctx, input) {
      calls.push({ actionId: id, input });
      return outputs;
    },
  };
}

/** A parking AgentChatPort (mirrors production ask_agent behavior) — pairs with AgentWaitService to resolve completions explicitly. */
function fakeChatPort(): { port: AgentChatPort; createCalls: Array<{ prompt: string }> } {
  const createCalls: Array<{ prompt: string }> = [];
  let counter = 0;
  const port: AgentChatPort = {
    async createChatAndSend(args) {
      counter += 1;
      createCalls.push({ prompt: args.prompt });
      return { chatId: `chat-${counter}` };
    },
    async sendMessage() {},
  };
  return { port, createCalls };
}

describe('Automations v2 conformance — reference automations 4-6', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-conformance-blocks-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    store = new RunStore(db);
    interactions = new InteractionStore(db, store);
    events = [];
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeInterpreter(ports: VerbPorts) {
    return new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
    });
  }

  it('morning PR sweep: github.list_prs feeds Repeat, spawning one agent chat per PR via ⟨current → url⟩', async () => {
    seedAutomation(db, 'auto-4', 'Morning PR sweep');
    const definition = loadFixture('morning-pr-sweep');
    expect(definition.triggers[0]).toMatchObject({ kind: 'schedule', schedule: { type: 'weekdays', at: '09:00' } });

    const calls: Array<{ actionId: string; input: unknown }> = [];
    const registry = new ActionRegistry();
    registry.register(
      fakeAction(
        'github.list_prs',
        {
          prs: [
            { url: 'https://github.com/x/repo/pull/1', title: 'A', number: 1, author: 'me' },
            { url: 'https://github.com/x/repo/pull/2', title: 'B', number: 2, author: 'me' },
            { url: 'https://github.com/x/repo/pull/3', title: 'C', number: 3, author: 'me' },
          ],
        },
        calls,
      ),
    );
    const runAction = makeRunActionExecutor({
      registry,
      resolveCredential: () => null,
      resolveProjectRoot: () => dir,
      logger: silentLogger,
    });

    const prompts: string[] = [];
    const ports = fakePorts({
      runAction,
      askAgent: async (step, ctx) => {
        prompts.push(renderChipText(ctx.tokens, step.prompt));
        return { type: 'completed', outputs: { result: '', chatId: `chat-${prompts.length}` } };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-4', definition, MANUAL, null);
    await interpreter.advance(run.id);

    expect(prompts).toEqual([
      '/codex-review https://github.com/x/repo/pull/1',
      '/codex-review https://github.com/x/repo/pull/2',
      '/codex-review https://github.com/x/repo/pull/3',
    ]);
    expect(store.getRun(run.id)?.status).toBe('succeeded');
    expect(store.getRun(run.id)?.checkpoint.steps['ask-review-pr#0']?.status).toBe('succeeded');
    expect(store.getRun(run.id)?.checkpoint.steps['ask-review-pr#2']?.status).toBe('succeeded');
  });

  describe('ship work', () => {
    function makeShipWorkPorts(calls: Array<{ actionId: string; input: unknown }>, agentPrompts: string[]): VerbPorts {
      const registry = new ActionRegistry();
      registry.register(fakeAction('ado.create_item', { workItemId: 501, url: 'https://ado/501' }, calls));
      registry.register(
        fakeAction('github.create_pr', { prUrl: 'https://github.com/x/repo/pull/9', prNumber: 9 }, calls),
      );
      const runAction = makeRunActionExecutor({
        registry,
        resolveCredential: () => null,
        resolveProjectRoot: () => dir,
        logger: silentLogger,
      });
      return fakePorts({
        runAction,
        askMe: makeAskMeExecutor(interactions, (e) => events.push(e)),
        askAgent: async (step, ctx) => {
          agentPrompts.push(renderChipText(ctx.tokens, step.prompt));
          return { type: 'completed', outputs: { result: '', chatId: 'chat-cleanup' } };
        },
      });
    }

    it('"create new": ado.create_item then github.create_pr with AB#<workItemId> in the body (then-branch)', async () => {
      seedAutomation(db, 'auto-5a', 'Ship work');
      const definition = loadFixture('ship-work');
      const calls: Array<{ actionId: string; input: unknown }> = [];
      const agentPrompts: string[] = [];
      const interpreter = makeInterpreter(makeShipWorkPorts(calls, agentPrompts));
      const run = interpreter.startRun('auto-5a', definition, MANUAL, null);
      await interpreter.advance(run.id);

      const interaction = interactions.findPendingForStep(run.id, 'ask-ado-link')!;
      const service = new InteractionService(
        interactions,
        (id) => interpreter.advance(id),
        (e) => events.push(e),
      );
      await service.respond(interaction.id, {
        action: 'create new',
        title: 'My feature',
        description: 'Does the thing',
      });

      expect(store.getRun(run.id)?.status).toBe('succeeded');
      const adoCall = calls.find((c) => c.actionId === 'ado.create_item');
      expect(adoCall?.input).toMatchObject({
        org: 'my-org',
        project: 'my-project',
        type: 'Task',
        title: 'My feature',
        description: 'Does the thing',
      });
      const prCall = calls.find((c) => c.actionId === 'github.create_pr');
      expect((prCall?.input as { body: string }).body).toBe('Ships the work. AB#501');
      expect((prCall?.input as { title: string }).title).toBe('My feature');
      expect((prCall?.input as { head: string }).head).toMatch(/^ship\/\d{4}-\d{2}-\d{2}$/);
      expect(agentPrompts[0]).toContain('Remove the worktree for ship/');
    });

    it('"skip": the otherwise branch is a no-op, and create-pr still works with the unset token rendering to \'\'', async () => {
      seedAutomation(db, 'auto-5b', 'Ship work');
      const definition = loadFixture('ship-work');
      const calls: Array<{ actionId: string; input: unknown }> = [];
      const agentPrompts: string[] = [];
      const interpreter = makeInterpreter(makeShipWorkPorts(calls, agentPrompts));
      const run = interpreter.startRun('auto-5b', definition, MANUAL, null);
      await interpreter.advance(run.id);

      const interaction = interactions.findPendingForStep(run.id, 'ask-ado-link')!;
      const service = new InteractionService(
        interactions,
        (id) => interpreter.advance(id),
        (e) => events.push(e),
      );
      await service.respond(interaction.id, { action: 'skip' });

      expect(store.getRun(run.id)?.status).toBe('succeeded');
      expect(calls.some((c) => c.actionId === 'ado.create_item')).toBe(false);
      const prCall = calls.find((c) => c.actionId === 'github.create_pr');
      expect((prCall?.input as { body: string }).body).toBe('Ships the work. AB#');
      expect((prCall?.input as { title: string }).title).toBe('');
    });
  });

  describe('daily feature spike (exercises A1 run_command safety, A2 typed expects, A3 is_one_of)', () => {
    /** Shared ask_agent wiring: a parking AgentChatPort behind AgentWaitService, same pattern both tests need. */
    function wireAskAgent(port: AgentChatPort, extraPorts: Partial<VerbPorts> = {}) {
      const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
      const waits = new AgentWaitService({
        db,
        store,
        advanceRun: (id) => interpreterBox.current!.advance(id),
        emitEvent: (e) => events.push(e),
        logger: silentLogger,
        sendMessage: (chatId, content) => port.sendMessage(chatId, content),
      });
      const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger), ...extraPorts });
      const interpreter = (interpreterBox.current = makeInterpreter(ports));
      return { interpreter, waits };
    }

    /**
     * Clones the fixture and strips the contract §9 prerequisite gap
     * (autoApprove/timeoutMinutes — proven fatal by the test below) to
     * exercise what A2/A3 do once the ChatManager param lands. Also loosens
     * `expects.scope` from the fixture's `choice` enum to `text` and swaps
     * the if-gate's value, so a HOSTILE string can flow through expects ->
     * the gate -> the run_command chip, proving A1's env-var isolation holds
     * for adversarial content, not just a clean 'xs'/'s'/'m' value. The
     * `verify-build` script is swapped from the real `pnpm --filter ... build`
     * for a fast, deterministic echo with the identical literal+chip+literal
     * shape, so A1's mechanism is exercised without a slow, environment-
     * dependent real build.
     */
    function buildSpikeHappyPathDefinition(projectRoot: string) {
      const definition = structuredClone(loadFixture('daily-feature-spike'));
      const pickFeature = definition.steps[0] as AskAgentStep;
      delete pickFeature.autoApprove;
      delete pickFeature.timeoutMinutes;
      pickFeature.expects = [{ key: 'scope', type: 'text' }];

      const ifBlock = definition.steps[1] as IfBlock;
      const marker = join(projectRoot, 'mf-pwned-marker');
      const hostileScope = `; touch ${marker}; `;
      ifBlock.conditions[0].value = [hostileScope];

      const verifyBuild = ifBlock.then[0] as RunActionStep;
      verifyBuild.params.script = [
        'echo "Verifying feature scope: ',
        { token: { stepId: 'pick-feature', output: 'scope' } },
        '"',
      ];
      return { definition, marker, hostileScope };
    }

    it('the unmodified fixture fails loudly through the REAL chat port — autoApprove has no ChatManager param yet (contract §9)', async () => {
      seedAutomation(db, 'auto-6a', 'Daily feature spike');
      const definition = loadFixture('daily-feature-spike');

      const stubChats = {
        createChatWithDefaults: vi.fn().mockResolvedValue({ id: 'chat-x' }),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };
      const port = makeAutomationChatPort(stubChats as never, () => 'proj-1');
      const { interpreter } = wireAskAgent(port);

      const run = interpreter.startRun('auto-6a', definition, MANUAL, null);
      await interpreter.advance(run.id);

      const finished = store.getRun(run.id)!;
      expect(finished.status).toBe('failed');
      expect(finished.checkpoint.steps['pick-feature']).toMatchObject({
        status: 'failed',
        error: 'auto-approve scope not yet supported',
      });
      // The guard fires before any chat is created — a green suite here can't
      // be hiding the missing-param gap behind a fake port that always succeeds.
      expect(stubChats.createChatWithDefaults).not.toHaveBeenCalled();
      expect(Object.keys(finished.checkpoint.steps)).toEqual(['pick-feature']);
    });

    it('with autoApprove/timeoutMinutes stripped: A1 + A2 + A3 all hold, including for a hostile scope value', async () => {
      seedAutomation(db, 'auto-6b', 'Daily feature spike');
      const { definition, marker, hostileScope } = buildSpikeHappyPathDefinition(dir);

      const registry = new ActionRegistry();
      registry.register(runCommandAction);
      const runAction = makeRunActionExecutor({
        registry,
        resolveCredential: () => null,
        resolveProjectRoot: () => dir,
        logger: silentLogger,
      });
      const notifyCalls: string[] = [];
      const { port, createCalls } = fakeChatPort();
      const { interpreter, waits } = wireAskAgent(port, {
        runAction,
        notify: async (step: NotifyStep) => {
          notifyCalls.push(step.id);
          return { type: 'completed', outputs: {} };
        },
      });

      const run = interpreter.startRun('auto-6b', definition, MANUAL, null);
      await interpreter.advance(run.id);
      expect(createCalls).toHaveLength(1);

      const { chatId } = waits.findByRunStep(run.id, 'pick-feature')!;
      waits.recordAssistantText(chatId, `Done thinking.\n${JSON.stringify({ scope: hostileScope })}`);
      await waits.onChatFinished(chatId, 'completed');

      const finished = store.getRun(run.id)!;
      expect(finished.status).toBe('succeeded');
      // A2: the declared key becomes a named output, whatever its content.
      expect(finished.checkpoint.steps['pick-feature']?.outputs).toMatchObject({ scope: hostileScope });
      // A3: is_one_of matched the hostile value verbatim, gating to the then-branch.
      expect(notifyCalls).toEqual(['notify-shipped']);
      // A1: the chip reached the script only via its quoted $MF_n placeholder — never shell source.
      expect(finished.checkpoint.steps['verify-build']?.status).toBe('succeeded');
      expect(existsSync(marker)).toBe(false);
      expect((finished.checkpoint.steps['verify-build']?.outputs as { output: string }).output).toContain(
        hostileScope.trim(),
      );
    });
  });
});

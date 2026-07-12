// packages/core/src/automations/service.ts
//
// Task 23. Mirrors workflows/index.ts's shape: one class owning the db,
// every store, the action registry (+builtins/curated; the MCP catalog is a
// post-launch addition behind AUTOMATIONS_MCP_ENABLED, not wired here),
// credentials, the interpreter, the cron scheduler, and the interaction +
// agent-wait services — then wires them into the four verb ports and the
// daemon-event/sweep entry points packages/core/src/index.ts calls.
// Trigger arming (schedule/event/webhook) lives in trigger-arming.ts.
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationSummary,
  DaemonEvent,
} from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from './db.js';
import { RunStore } from './store/run-store.js';
import { InteractionStore } from './store/interaction-store.js';
import type { AutomationRunRecord } from './store/types.js';
import { AutomationInterpreter } from './engine/interpreter.js';
import type { VerbPorts } from './engine/types.js';
import { AutomationDefinitionSchema } from './definition/schema.js';
import { validateScopes, type CatalogOutputs, type ScopeError } from './definition/validate.js';
import { ActionRegistry } from './actions/registry.js';
import { registerAllActions } from './actions/register-all.js';
import { FileCredentialStore } from './credentials.js';
import { CronScheduler } from './triggers/scheduler.js';
import { matchEventTriggers } from './triggers/events.js';
import { makeAskAgentExecutor, type AgentChatPort } from './verbs/ask-agent.js';
import { makeAskMeExecutor, InteractionService } from './verbs/ask-me.js';
import { makeNotifyExecutor, type NotifyPushPort } from './verbs/notify.js';
import { AgentWaitService } from './verbs/agent-waits.js';
import { makeRunActionExecutor } from './verbs/run-action.js';
import { reconcileAutomationsOnBoot } from './reconciler.js';
import { TriggerArmer } from './trigger-arming.js';
import {
  rowToSummary,
  zodIssuesToScopeErrors,
  eventDedupSource,
  extractAssistantText,
  summarizeRunResult,
  type AutomationRow,
} from './service-helpers.js';

export class AutomationValidationError extends Error {
  constructor(public readonly errors: ScopeError[]) {
    super(errors.map((e) => e.message).join('; ') || 'automation definition is invalid');
    this.name = 'AutomationValidationError';
  }
}

export interface AutomationServiceDeps {
  dataDir: string;
  logger: Logger;
  emitEvent: (event: DaemonEvent) => void;
  agentPort: AgentChatPort;
  listProjects: () => Array<{ id: string; path: string }>;
  pushService?: NotifyPushPort;
}

export class AutomationService {
  readonly db: AutomationDb;
  readonly store: RunStore;
  readonly interactions: InteractionStore;
  readonly interactionService: InteractionService;
  readonly agentWaits: AgentWaitService;
  readonly registry: ActionRegistry;
  readonly credentials: FileCredentialStore;
  readonly scheduler: CronScheduler;
  readonly interpreter: AutomationInterpreter;
  private readonly triggers: TriggerArmer;

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: AutomationServiceDeps) {
    const logger = deps.logger.child({ module: 'automations' });
    this.db = openAutomationDb(join(deps.dataDir, 'automations.db'));
    this.store = new RunStore(this.db);
    this.interactions = new InteractionStore(this.db, this.store);
    this.registry = new ActionRegistry();
    registerAllActions(this.registry);
    this.credentials = new FileCredentialStore(join(deps.dataDir, 'automation-credentials.json'), logger);

    this.agentWaits = new AgentWaitService({
      db: this.db,
      store: this.store,
      advanceRun: (runId) => this.interpreter.advance(runId),
      emitEvent: deps.emitEvent,
      logger,
      sendMessage: (chatId, content) => deps.agentPort.sendMessage(chatId, content),
      onRunFinalized: (runId) => this.emitCompletionEvent(runId),
    });

    this.interpreter = new AutomationInterpreter({
      store: this.store,
      interactions: this.interactions,
      ports: this.buildPorts(logger),
      emitEvent: deps.emitEvent,
      logger,
      onRunFinalized: (runId) => this.emitCompletionEvent(runId),
      isIdempotent: (step) => step.kind === 'run_action' && this.registry.isIdempotent(step.actionId),
    });

    this.interactionService = new InteractionService(
      this.interactions,
      (runId) => this.interpreter.advance(runId),
      deps.emitEvent,
    );
    this.scheduler = new CronScheduler(this.db, logger, (automationId, triggerId, scheduledFor) =>
      this.triggers.fireRun(
        automationId,
        { kind: 'schedule', triggerId, scheduledFor },
        `${triggerId}|${scheduledFor}`,
      ),
    );
    this.triggers = new TriggerArmer({
      scheduler: this.scheduler,
      credentials: this.credentials,
      interpreter: this.interpreter,
      getRow: (id) => this.getRow(id),
      logger,
    });
  }

  private buildPorts(logger: Logger): VerbPorts {
    return {
      runAction: makeRunActionExecutor({
        registry: this.registry,
        resolveCredential: (label) => this.credentials.get(label),
        resolveProjectRoot: (runId) => this.resolveProjectRoot(runId),
        logger,
      }),
      askAgent: makeAskAgentExecutor(this.deps.agentPort, this.agentWaits, logger),
      askMe: makeAskMeExecutor(this.interactions, this.deps.emitEvent),
      notify: makeNotifyExecutor({
        db: this.db,
        store: this.store,
        emitEvent: this.deps.emitEvent,
        pushService: this.deps.pushService,
        logger,
      }),
    };
  }

  async start(): Promise<void> {
    const rows = this.db.prepare(`SELECT * FROM automations WHERE enabled = 1`).all() as AutomationRow[];
    this.triggers.armAll(rows);
    await reconcileAutomationsOnBoot(this.db, this.store, this.interpreter, this.deps.logger);
    this.sweepTimer = setInterval(() => this.sweep(Date.now()), 30_000);
    this.sweepTimer.unref();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  sweep(now: number): void {
    this.scheduler.sweep(now);
    void this.interpreter.sweepDeadlines(now).catch((err: unknown) => {
      this.deps.logger.error({ err }, 'automation sweep: sweepDeadlines failed');
    });
  }

  /** Feed daemon events: chat lifecycle to agent waits, event triggers to new runs (mirrors workflows/index.ts). */
  onDaemonEvent(event: DaemonEvent): void {
    if (event.type === 'chat.updated' && event.reason) {
      void this.agentWaits.onChatFinished(event.chat.id, event.reason).catch((err: unknown) => {
        this.deps.logger.error({ err }, 'automation onDaemonEvent: onChatFinished failed');
      });
    }
    if (event.type === 'message.added' && event.message.type === 'assistant') {
      const text = extractAssistantText(event.message.content);
      if (text !== null) this.agentWaits.recordAssistantText(event.chatId, text);
    }

    const dedupSource = eventDedupSource(event);
    if (dedupSource === null) return;
    const matches = matchEventTriggers(
      this.triggers.eventBindings,
      event,
      (chatId) => this.agentWaits.findByChat(chatId) !== null,
    );
    for (const match of matches) {
      const dedupKey = `${match.binding.triggerId}|${dedupSource}`;
      this.triggers.fireRun(
        match.binding.automationId,
        { kind: 'event', triggerId: match.binding.triggerId, payload: match.tokens },
        dedupKey,
      );
    }
  }

  get(id: string): AutomationSummary | null {
    const row = this.getRow(id);
    return row ? rowToSummary(row) : null;
  }

  list(): AutomationSummary[] {
    const rows = this.db.prepare(`SELECT * FROM automations ORDER BY created_at`).all() as AutomationRow[];
    return rows.map(rowToSummary);
  }

  /** Validates (schema + scopes), inserts, and arms the new automation's triggers. Throws AutomationValidationError on either failure. */
  create(input: AutomationCreateInput): AutomationSummary {
    const definition = this.validateDefinition(input.definition);
    const id = nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO automations (id, name, description, scope, project_id, enabled, definition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.scope,
        input.projectId ?? null,
        JSON.stringify(definition),
        now,
        now,
      );

    const row = this.getRow(id)!;
    this.triggers.arm(row);
    return rowToSummary(row);
  }

  /** Re-validates and re-arms — old triggers are disarmed first so a removed/changed trigger doesn't linger. */
  update(id: string, input: AutomationCreateInput): AutomationSummary {
    if (!this.getRow(id)) throw new Error(`automation not found: ${id}`);
    const definition = this.validateDefinition(input.definition);

    this.triggers.disarm(id);
    this.db
      .prepare(
        `UPDATE automations SET name = ?, description = ?, scope = ?, project_id = ?, definition = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.description ?? null,
        input.scope,
        input.projectId ?? null,
        JSON.stringify(definition),
        Date.now(),
        id,
      );

    const row = this.getRow(id)!;
    if (row.enabled === 1) this.triggers.arm(row);
    return rowToSummary(row);
  }

  /** Contract Decision 11: disabling disarms triggers; manual runs stay allowed regardless of enabled. */
  setEnabled(id: string, enabled: boolean): AutomationSummary {
    if (!this.getRow(id)) throw new Error(`automation not found: ${id}`);
    this.db
      .prepare(`UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, Date.now(), id);

    const row = this.getRow(id)!;
    if (enabled) this.triggers.arm(row);
    else this.triggers.disarm(id);
    return rowToSummary(row);
  }

  runManually(id: string): AutomationRunRecord {
    const row = this.getRow(id);
    if (!row) throw new Error(`automation not found: ${id}`);
    const definition = JSON.parse(row.definition) as AutomationDefinition;
    const run = this.interpreter.startRun(id, definition, { kind: 'manual' }, null);
    void this.interpreter.advance(run.id).catch((err: unknown) => {
      this.deps.logger.error({ err, runId: run.id }, 'automation runManually: advance failed');
    });
    return run;
  }

  private validateDefinition(definition: AutomationDefinition): AutomationDefinition {
    const parsed = AutomationDefinitionSchema.safeParse(definition);
    if (!parsed.success) throw new AutomationValidationError(zodIssuesToScopeErrors(parsed.error));
    const scopeErrors = validateScopes(parsed.data, this.catalogOutputs());
    if (scopeErrors.length > 0) throw new AutomationValidationError(scopeErrors);
    return parsed.data;
  }

  private catalogOutputs(): CatalogOutputs {
    return Object.fromEntries(this.registry.catalog().map((a) => [a.id, a.outputs.map((o) => o.name)]));
  }

  private getRow(id: string): AutomationRow | null {
    const row = this.db.prepare(`SELECT * FROM automations WHERE id = ?`).get(id) as AutomationRow | undefined;
    return row ?? null;
  }

  /** run_action's ActionCtx.projectRoot: the automation's own project if it has one, else the workspace's first project, else cwd. */
  private resolveProjectRoot(runId: string): string {
    const run = this.store.getRun(runId);
    const row = run ? this.getRow(run.automationId) : null;
    const projects = this.deps.listProjects();
    const project = row?.project_id ? projects.find((p) => p.id === row.project_id) : undefined;
    return project?.path ?? projects[0]?.path ?? process.cwd();
  }

  private emitCompletionEvent(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run || (run.status !== 'succeeded' && run.status !== 'failed')) return;
    const row = this.getRow(run.automationId);
    this.deps.emitEvent({
      type: 'automation.completed',
      automationId: run.automationId,
      automationName: row?.name ?? run.automationId,
      runId,
      status: run.status,
      result: summarizeRunResult(run),
    });
  }
}

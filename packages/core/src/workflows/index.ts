import { join } from 'node:path';
import type { Logger } from 'pino';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { openWorkflowDb, type WorkflowDb } from './db.js';
import { RunStore } from './store/run-store.js';
import { InteractionStore } from './store/interaction-store.js';
import { WorkflowEngine } from './engine/engine.js';
import { ConnectorRegistry } from './connectors/registry.js';
import { filesConnector } from './connectors/files.js';
import { bashConnector } from './connectors/bash.js';
import { httpConnector } from './connectors/http.js';
import { FileCredentialStore } from './credentials.js';
import { WorkflowLoader } from './loader.js';
import { CronScheduler } from './triggers/scheduler.js';
import { matchEventTriggers, type EventTriggerBinding } from './triggers/events.js';
import { InteractionService } from './interactions.js';
import { AgentWaitService } from './agent-waits.js';
import { makeQuestionExecutor } from './engine/executors/question.js';
import { makeAgentExecutor, type AgentChatPort } from './engine/executors/agent.js';
import { makeCallExecutor, CallCoordinator } from './engine/executors/call.js';
import { reconcileOnBoot } from './reconciler.js';

export { WorkflowLoader } from './loader.js';
export type { LoadedWorkflow, ScanResult } from './loader.js';

export interface WorkflowServiceDeps {
  dataDir: string;
  logger: Logger;
  emitEvent: (event: DaemonEvent) => void;
  agentPort: AgentChatPort;
  listProjects: () => Array<{ id: string; path: string }>;
}

export class WorkflowService {
  readonly db: WorkflowDb;
  readonly store: RunStore;
  readonly interactions: InteractionStore;
  readonly interactionService: InteractionService;
  readonly agentWaits: AgentWaitService;
  readonly engine: WorkflowEngine;
  readonly loader: WorkflowLoader;
  readonly connectors: ConnectorRegistry;
  readonly credentials: FileCredentialStore;
  readonly scheduler: CronScheduler;
  private eventBindings: EventTriggerBinding[] = [];
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: WorkflowServiceDeps) {
    const logger = deps.logger.child({ module: 'workflows' });
    this.db = openWorkflowDb(join(deps.dataDir, 'workflows.db'));
    this.store = new RunStore(this.db);
    this.interactions = new InteractionStore(this.db);
    this.connectors = new ConnectorRegistry();
    this.connectors.register(filesConnector);
    this.connectors.register(bashConnector);
    this.connectors.register(httpConnector);
    this.credentials = new FileCredentialStore(join(deps.dataDir, 'workflow-credentials.json'), logger);
    this.loader = new WorkflowLoader(this.db, logger);
    this.agentWaits = new AgentWaitService(this.db, this.store, logger);
    const coordinator = new CallCoordinator(this.store, (name) => this.loader.findByName(name, null), logger);
    this.engine = new WorkflowEngine(
      {
        store: this.store,
        connectors: this.connectors,
        logger,
        emitEvent: deps.emitEvent,
        executors: {
          question: makeQuestionExecutor(this.interactions, deps.emitEvent),
          agent: makeAgentExecutor(deps.agentPort, this.agentWaits),
          call: makeCallExecutor(coordinator),
        },
        onRunFinalized: async (runId) => {
          await coordinator.onRunFinalized(runId);
          this.emitCompletionEvent(runId);
        },
      },
      (label) => this.credentials.get(label),
    );
    this.agentWaits.bindEngine(this.engine);
    coordinator.bindEngine(this.engine);
    this.interactionService = new InteractionService(
      this.interactions,
      this.store,
      this.engine,
      logger,
      deps.emitEvent,
    );
    this.scheduler = new CronScheduler(this.db, logger, (workflowId) => {
      const wf = this.loader.get(workflowId);
      if (!wf) return;
      const run = this.engine.startRun({
        workflowId,
        definition: wf.definition,
        triggerKind: 'cron',
        triggerPayload: null,
        inputs: {},
      });
      void this.engine.advance(run.id).catch((err: unknown) => {
        logger.error({ err, runId: run.id }, 'cron-triggered advance failed');
      });
    });
  }

  async start(): Promise<void> {
    await this.rescan();
    await reconcileOnBoot(this.db, this.store, this.engine, this.deps.logger);
    this.sweepTimer = setInterval(() => {
      this.sweep(Date.now());
    }, 30_000);
    this.sweepTimer.unref();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async rescan(): Promise<{ errors: Array<{ file: string; error: string }> }> {
    const errors: Array<{ file: string; error: string }> = [];
    const globalResult = await this.loader.scanDir(join(this.deps.dataDir, 'workflows'), null);
    errors.push(...globalResult.errors);
    for (const project of this.deps.listProjects()) {
      const res = await this.loader.scanDir(join(project.path, '.mainframe', 'workflows'), project.id);
      errors.push(...res.errors);
    }
    this.armTriggers();
    return { errors };
  }

  private armTriggers(): void {
    this.eventBindings = [];
    const now = Date.now();
    for (const wf of this.loader.list()) {
      (wf.definition.triggers ?? []).forEach((trigger, index) => {
        if ('schedule' in trigger) {
          this.scheduler.arm(wf.id, index, trigger.schedule.cron, trigger.schedule.on_missed ?? 'skip', now);
        }
        if ('event' in trigger) {
          this.eventBindings.push({
            workflowId: wf.id,
            definition: wf.definition,
            on: trigger.event.on,
            workflowFilter: trigger.event.workflow,
          });
        }
      });
    }
  }

  sweep(now: number): void {
    this.scheduler.sweep(now);
    for (const run of this.store.listDueRuns(now)) {
      void this.wakeTimedOut(run.id).catch((err: unknown) => {
        this.deps.logger.error({ err, runId: run.id }, 'sweep wakeTimedOut failed');
      });
    }
    void this.interactionService.expireDue(now).catch((err: unknown) => {
      this.deps.logger.error({ err }, 'sweep expireDue failed');
    });
  }

  /** Feed daemon events: chat lifecycle to agent waits, event triggers to new runs. */
  onDaemonEvent(event: DaemonEvent): void {
    if (event.type === 'chat.updated' && event.reason) {
      void this.agentWaits.onChatFinished(event.chat.id, event.reason).catch((err: unknown) => {
        this.deps.logger.error({ err }, 'onChatFinished failed');
      });
    }
    if (event.type === 'message.added' && event.message.type === 'assistant') {
      const text = extractAssistantText(event.message.content);
      if (text !== null) {
        this.agentWaits.recordAssistantText(event.chatId, text);
      }
    }
    const matches = matchEventTriggers(this.eventBindings, event.type, event as unknown as Record<string, unknown>);
    for (const binding of matches) {
      const run = this.engine.startRun({
        workflowId: binding.workflowId,
        definition: binding.definition,
        triggerKind: 'event',
        triggerPayload: event,
        inputs: {},
      });
      void this.engine.advance(run.id).catch((err: unknown) => {
        this.deps.logger.error({ err, runId: run.id }, 'event-triggered advance failed');
      });
    }
  }

  private async wakeTimedOut(runId: string): Promise<void> {
    for (const [stepPath, step] of this.store.latestStepResults(runId)) {
      if (step.status !== 'waiting') continue;
      if (step.kind === 'agent') {
        this.store.commitStep(runId, {
          stepPath,
          stepId: step.stepId,
          kind: step.kind,
          attempt: step.attempt,
          status: 'failed',
          input: null,
          output: null,
          scratch: step.scratch,
          error: 'agent step deadline exceeded',
        });
      }
      // question waits are expired by interactionService.expireDue; call waits have no deadline
    }
    await this.engine.advance(runId);
  }

  private emitCompletionEvent(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run || run.status !== 'succeeded') return;
    const wf = this.loader.get(run.workflowId);
    this.deps.emitEvent({
      type: 'workflow.completed',
      workflowId: run.workflowId,
      workflowName: wf?.name ?? '',
      runId,
      outputs: run.outputs,
    });
  }
}

/** Extract concatenated text from a ChatMessage content array. Returns null when no text blocks. */
function extractAssistantText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

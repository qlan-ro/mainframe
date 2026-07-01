import type { Logger } from 'pino';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { RunStore } from '../store/run-store.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { RunRecord, StepRunRecord } from '../store/types.js';
import type { StepDef } from '../dsl/types.js';

export type Scope = Record<string, unknown>;

export interface PendingWait {
  kind: 'question' | 'agent' | 'timer' | 'call';
  wakeAt: number | null;
}

export type StepOutcome =
  | { type: 'completed'; output: unknown; scratch?: Record<string, unknown> }
  | { type: 'wait'; wait: PendingWait; scratch?: Record<string, unknown> }
  | { type: 'failed'; error: string; retryable: boolean };

export interface StepContext {
  run: RunRecord;
  stepPath: string;
  attempt: number;
  scope: Scope;
  prior: StepRunRecord | null;
  logger: Logger;
  signal: AbortSignal;
}

/** Executors for step kinds that need external services (agent, question, call). */
export type ExecutorMap = Partial<
  Record<'agent' | 'question' | 'call', (ctx: StepContext, step: StepDef) => Promise<StepOutcome>>
>;

export interface EngineDeps {
  store: RunStore;
  connectors: ConnectorRegistry;
  logger: Logger;
  emitEvent: (event: DaemonEvent) => void;
  executors: ExecutorMap;
}

/** Walk result for a sequence/block. */
export type WalkResult = { type: 'done'; scope: Scope } | { type: 'parked' } | { type: 'failed'; error: string };

// packages/core/src/automations/engine/types.ts
//
// The interpreter's injection seam (contract §2, Decision 12). VerbPorts
// abstracts the four Do-verbs so the linear walk (walk.ts) and the
// serialized advance loop (interpreter.ts) stay independent of the real
// verb implementations — ask_agent/ask_me land in Phase 4, run_action's
// builtins/connectors in Phase 3. Tests here use fakes.
import type { AskAgentStep, AskMeStep, NotifyStep, RunActionStep } from '@qlan-ro/mainframe-types';
import type { TokenContext } from '../tokens/substitute.js';

export type StepOutcome =
  | { type: 'completed'; outputs: Record<string, unknown> }
  | { type: 'wait'; wakeAt: number | null; kind: string }
  | { type: 'failed'; error: string };

export interface VerbContext {
  runId: string;
  stepRef: string;
  tokens: TokenContext;
  signal: AbortSignal;
}

export interface VerbPorts {
  runAction(step: RunActionStep, ctx: VerbContext): Promise<StepOutcome>;
  askAgent(step: AskAgentStep, ctx: VerbContext): Promise<StepOutcome>;
  askMe(step: AskMeStep, ctx: VerbContext): Promise<StepOutcome>;
  notify(step: NotifyStep, ctx: VerbContext): Promise<StepOutcome>;
}

/** Result of walking one step sequence to the end, a park point, or a hard failure. */
export type WalkResult = { type: 'done' } | { type: 'parked' } | { type: 'failed'; error: string };

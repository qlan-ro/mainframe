/**
 * yaml-serialize — canonical YAML serializer for the workflow builder.
 *
 * `serializeWorkflow(model)` converts a WfDraft into the canonical YAML grammar
 * used on disk: `draftToObject` maps the model to a plain JS object mirroring
 * `packages/core/src/workflows/dsl/schema.ts`, then `YAML.stringify` renders it.
 * Undefined-valued keys are dropped by the `yaml` package by default, so every
 * absent optional field simply omits its key rather than emitting `key: null`.
 */
import YAML from 'yaml';
import type { WfArm, WfDraft, WfInput, WfOutput, WfStep, WfTrigger, WfVar } from './wf-draft-types';
import { slug } from './wf-slug';

// ── Trigger / input / var / output maps ──────────────────────────────────────

function triggerToObject(t: WfTrigger): Record<string, unknown> | undefined {
  switch (t.kind) {
    case 'manual':
      return undefined;
    case 'schedule':
      return { schedule: { cron: t.cron, on_missed: t.on_missed } };
    case 'event':
      return { event: { on: t.on, workflow: t.workflow } };
  }
}

function inputsToObject(inputs: WfInput[]): Record<string, unknown> | undefined {
  if (inputs.length === 0) return undefined;
  const obj: Record<string, unknown> = {};
  for (const i of inputs) {
    obj[i.name] = { type: i.type, title: i.title, default: i.default, required: i.required, enum: i.enum };
  }
  return obj;
}

function varsToObject(vars: WfVar[]): Record<string, unknown> | undefined {
  if (vars.length === 0) return undefined;
  const obj: Record<string, unknown> = {};
  for (const v of vars) obj[v.key] = v.value;
  return obj;
}

function outputsToObject(outputs: WfOutput[]): Record<string, string> | undefined {
  if (outputs.length === 0) return undefined;
  const obj: Record<string, string> = {};
  for (const o of outputs) obj[o.name] = o.expr;
  return obj;
}

// ── Step tree ─────────────────────────────────────────────────────────────────

function armToObject(a: WfArm): Record<string, unknown> {
  return { ...(a.else ? { else: true } : { when: a.when }), steps: a.steps.map(stepToObject) };
}

function stepBodyToObject(s: WfStep): Record<string, unknown> {
  switch (s.kind) {
    case 'agent':
      return {
        agent: {
          prompt: s.agent.prompt,
          adapterId: s.agent.adapterId,
          model: s.agent.model,
          permissionMode: s.agent.permissionMode,
          projectId: s.agent.projectId,
          worktree: s.agent.worktree,
          timeoutMinutes: s.agent.timeoutMinutes,
        },
      };
    case 'form':
      return { form: { title: s.form.title, timeout: s.form.timeout, fields: s.form.fields } };
    case 'service':
      return { connector: s.connector, with: s.with, credential: s.credential };
    case 'choose':
      return { choose: s.arms.map(armToObject) };
    case 'foreach':
      return { foreach: s.over, as: s.as, steps: s.steps.map(stepToObject) };
    case 'parallel':
      return { parallel: Object.fromEntries(Object.entries(s.branches).map(([k, v]) => [k, v.map(stepToObject)])) };
    case 'call':
      return { call: s.ref, with: s.with };
    case 'set':
      return { set: s.set };
  }
}

function stepToObject(s: WfStep): Record<string, unknown> {
  return { id: s.id, name: s.name, retry: s.retry, on_failure: s.onFailure, output: s.output, ...stepBodyToObject(s) };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Maps a WfDraft to the plain object mirroring the canonical DSL grammar. */
export function draftToObject(d: WfDraft): Record<string, unknown> {
  const triggers = d.triggers.map(triggerToObject).filter((t): t is Record<string, unknown> => t !== undefined);
  return {
    version: 1,
    name: slug(d.name),
    description: d.description || undefined,
    triggers: triggers.length > 0 ? triggers : undefined,
    inputs: inputsToObject(d.inputs),
    vars: varsToObject(d.vars),
    steps: d.steps.map(stepToObject),
    outputs: outputsToObject(d.outputs),
  };
}

/**
 * Serialize a WfDraft model into canonical YAML.
 *
 * Called live on every builder change so the YAML pane stays in sync.
 * Output is deterministic for a given model (no timestamps, no randomness).
 */
export function serializeWorkflow(d: WfDraft): string {
  return YAML.stringify(draftToObject(d), { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}

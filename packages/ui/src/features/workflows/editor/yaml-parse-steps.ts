/**
 * yaml-parse-steps — per-kind mappers from parsed YAML step/arm/field/trigger
 * objects to the v2 WfStep/WfArm/WfField/WfTrigger model. Kept out of
 * yaml-parse.ts so both files stay ≤ 300 lines / functions ≤ 50 lines.
 */
import type { WfArm, WfField, WfStep, WfTrigger } from './wf-draft-types';

export type StepResult = { ok: true; step: WfStep } | { ok: false; reason: string };
export type StepsResult = { ok: true; steps: WfStep[] } | { ok: false; reason: string };
export type ArmResult = { ok: true; arm: WfArm } | { ok: false; reason: string };
export type TriggerResult = { ok: true; trigger: WfTrigger } | { ok: false; reason: string };

type BaseFields = Pick<WfStep, 'id' | 'name' | 'retry' | 'onFailure' | 'output'>;

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

export function mapField(raw: Record<string, unknown>): WfField {
  return {
    key: raw['key'] as string,
    type: raw['type'] as WfField['type'],
    label: raw['label'] as string | undefined,
    options: raw['options'] as string[] | undefined,
    required: raw['required'] as boolean | undefined,
    when: raw['when'] as WfField['when'],
  };
}

/** Maps a raw YAML steps array, short-circuiting on the first unmappable step. */
export function mapSteps(raw: unknown): StepsResult {
  const steps: WfStep[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const res = mapStep(r);
    if (!res.ok) return res;
    steps.push(res.step);
  }
  return { ok: true, steps };
}

export function mapArm(raw: Record<string, unknown>): ArmResult {
  const stepsResult = mapSteps(raw['steps']);
  if (!stepsResult.ok) return stepsResult;
  if (raw['else'] === true) return { ok: true, arm: { else: true, steps: stepsResult.steps } };
  return { ok: true, arm: { when: raw['when'] as string, steps: stepsResult.steps } };
}

function mapArms(raw: unknown): { ok: true; arms: WfArm[] } | { ok: false; reason: string } {
  const arms: WfArm[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const res = mapArm(asRecord(r));
    if (!res.ok) return res;
    arms.push(res.arm);
  }
  return { ok: true, arms };
}

function mapBranches(raw: unknown): { ok: true; branches: Record<string, WfStep[]> } | { ok: false; reason: string } {
  const branches: Record<string, WfStep[]> = {};
  for (const [key, value] of Object.entries(asRecord(raw))) {
    const res = mapSteps(value);
    if (!res.ok) return res;
    branches[key] = res.steps;
  }
  return { ok: true, branches };
}

function baseFieldsOf(s: Record<string, unknown>, id: string): BaseFields {
  return {
    id,
    name: s['name'] as string | undefined,
    retry: s['retry'] as WfStep['retry'],
    onFailure: s['on_failure'] as WfStep['onFailure'],
    output: s['output'],
  };
}

function mapFormStep(base: BaseFields, body: Record<string, unknown>): StepResult {
  const fields = ((body['fields'] as unknown[]) ?? []).map((f) => mapField(asRecord(f)));
  return {
    ok: true,
    step: {
      ...base,
      kind: 'form',
      form: {
        title: body['title'] as string,
        timeout: body['timeout'] as { afterMinutes: number; onTimeout: 'cancel' | 'fail' | 'continue' } | undefined,
        fields,
      },
    },
  };
}

function mapAgentStep(base: BaseFields, a: Record<string, unknown>): StepResult {
  return {
    ok: true,
    step: {
      ...base,
      kind: 'agent',
      agent: {
        prompt: a['prompt'] as string,
        adapterId: a['adapterId'] as string | undefined,
        model: a['model'] as string | undefined,
        permissionMode: a['permissionMode'] as string | undefined,
        projectId: a['projectId'] as string | undefined,
        worktree: a['worktree'] as { branchName: string; baseBranch?: string } | undefined,
        timeoutMinutes: a['timeoutMinutes'] as number | undefined,
      },
    },
  };
}

/** Maps a parsed YAML step object to a v2 WfStep, or ok:false for an unrecognized/conflicting shape. */
export function mapStep(raw: unknown): StepResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'step is not an object' };
  const s = raw as Record<string, unknown>;
  const id = typeof s['id'] === 'string' ? (s['id'] as string) : 'unknown';
  const base = baseFieldsOf(s, id);

  if ('form' in s && 'question' in s) return { ok: false, reason: `step ${id} declares both form: and question:` };
  if ('form' in s || 'question' in s) return mapFormStep(base, asRecord(s['form'] ?? s['question']));
  if ('connector' in s) {
    return {
      ok: true,
      step: {
        ...base,
        kind: 'service',
        connector: s['connector'] as string,
        with: s['with'] as Record<string, unknown> | undefined,
        credential: s['credential'] as string | undefined,
      },
    };
  }
  if ('agent' in s) return mapAgentStep(base, asRecord(s['agent']));
  if ('choose' in s) {
    const armsResult = mapArms(s['choose']);
    if (!armsResult.ok) return armsResult;
    return { ok: true, step: { ...base, kind: 'choose', arms: armsResult.arms } };
  }
  if ('foreach' in s) {
    const stepsResult = mapSteps(s['steps']);
    if (!stepsResult.ok) return stepsResult;
    return {
      ok: true,
      step: { ...base, kind: 'foreach', over: s['foreach'] as string, as: s['as'] as string, steps: stepsResult.steps },
    };
  }
  if ('parallel' in s) {
    const branchesResult = mapBranches(s['parallel']);
    if (!branchesResult.ok) return branchesResult;
    return { ok: true, step: { ...base, kind: 'parallel', branches: branchesResult.branches } };
  }
  if ('call' in s) {
    return {
      ok: true,
      step: { ...base, kind: 'call', ref: s['call'] as string, with: s['with'] as Record<string, unknown> | undefined },
    };
  }
  if ('set' in s) return { ok: true, step: { ...base, kind: 'set', set: s['set'] as Record<string, unknown> } };

  return { ok: false, reason: `unsupported step: ${id}` };
}

/** Maps a parsed YAML trigger object to a v2 WfTrigger, or ok:false if unrecognized. */
export function mapTrigger(raw: unknown): TriggerResult {
  const t = asRecord(raw);
  if ('schedule' in t) {
    const sched = t['schedule'];
    if (typeof sched === 'string') return { ok: true, trigger: { kind: 'schedule', cron: sched } };
    const s = asRecord(sched);
    return {
      ok: true,
      trigger: {
        kind: 'schedule',
        cron: s['cron'] as string,
        on_missed: s['on_missed'] as 'skip' | 'run_once' | undefined,
      },
    };
  }
  if ('event' in t) {
    const e = asRecord(t['event']);
    return {
      ok: true,
      trigger: { kind: 'event', on: e['on'] as string, workflow: e['workflow'] as string | undefined },
    };
  }
  return { ok: false, reason: 'unrecognized trigger' };
}
